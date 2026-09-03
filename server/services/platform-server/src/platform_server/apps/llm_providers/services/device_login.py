"""设备码登录的两步：开个头、问一次好了没。

⚠ 轮询由**浏览器**驱动，服务端不起后台任务：api 角色是无状态的，第二次轮询
可能落到另一个副本上；起后台任务的话，那个副本上的任务在关停时被 drain 掉，
而用户看到的是「一直转圈」。

⚠ `device_auth_id` 是密钥态，**一个字都不下发**：交给浏览器的只是一个不可猜的
句柄。它连同用户码与轮询间隔一起放 Redis，TTL 就是上游给的有效期——过期即消失，
不用自己清。

⚠ PKCE 的 verifier **不在我们手上**：这一路是服务端生成、轮询成功时连着授权码
一起给回来的，所以这里没有可存的东西（见 `oauth_client` 文件头第 3 条）。
"""

import secrets
import uuid
from dataclasses import dataclass
from typing import Any, Protocol, cast

from lib.cache import CacheLike
from lib.logging import get_logger
from platform_server.apps.llm_providers.enums import AUTH_MODE_CHATGPT
from platform_server.apps.llm_providers.errors import LlmLoginSessionExpired
from platform_server.apps.llm_providers.services.oauth_client import OAuthClient
from platform_server.apps.llm_providers.services.tokens import TokenBundle

_logger = get_logger("platform.llm_providers.login")

# Redis 键前缀。⚠ 带服务名以外还带用途：共用一个 Redis 的两个用途撞上同一个
# 句柄时，会互相读到对方的东西
_KEY_PREFIX = "platform:llm-device-login"
# 句柄的字节数。它是这次登录的唯一凭证，短了就能被猜
_REF_BYTES = 24
# 抬高间隔后续多久。⚠ 比上游的码有效期长没关系：真过期了上游会回 expired_token
_KEEP_TTL_S = 900


class CredentialSink(Protocol):
    """登录成功之后把令牌交给谁。

    ⚠ 收窄成一个方法而不是收整个读写面：这一层只会「存一份」，而把整个读写面
    接进来之后，用例要为它准备一整套数据库。
    """

    async def save(
        self,
        provider_id: uuid.UUID,
        bundle: TokenBundle,
        *,
        auth_mode: str,
        actor: str | None,
    ) -> None: ...


@dataclass(frozen=True)
class LoginStarted:
    """开了个头，把这几样给界面。"""

    ref: str
    user_code: str
    verification_uri: str
    interval_s: int
    expires_in_s: int


@dataclass(frozen=True)
class LoginProgress:
    """问了一次的结果。`is_done` 为真表示已经登录好了。"""

    is_done: bool
    interval_s: int


@dataclass(frozen=True)
class _Pending:
    provider_id: uuid.UUID
    device_auth_id: str
    user_code: str
    interval_s: int


class DeviceLogin:
    """驱动一次设备码登录。"""

    def __init__(
        self,
        *,
        oauth: OAuthClient,
        cache: CacheLike,
        store: CredentialSink,
    ) -> None:
        """Args: oauth, cache, store。"""
        self._oauth = oauth
        self._cache = cache
        self._store = store

    async def start(self, provider_id: uuid.UUID) -> LoginStarted:
        """要一个用户码与验证地址。

        Args: provider_id。
        """
        started = await self._oauth.start_device_code()
        ref = secrets.token_urlsafe(_REF_BYTES)
        await self._cache.set_json(
            _key(ref),
            _pending_json(
                provider_id,
                device_auth_id=started.device_auth_id,
                user_code=started.user_code,
                interval_s=started.interval_s,
            ),
            # ⚠ TTL 至少一秒：上游给的是绝对时刻，算出来可能已经是 0
            ttl_s=max(started.expires_in_s, 1),
        )
        _logger.info(
            "llm_device_login_started",
            "设备码登录已开始",
            provider_id=str(provider_id),
        )
        return LoginStarted(
            ref=ref,
            user_code=started.user_code,
            verification_uri=started.verification_uri,
            interval_s=started.interval_s,
            expires_in_s=started.expires_in_s,
        )

    async def poll(self, ref: str, *, actor: str | None) -> LoginProgress:
        """问一次「用户点完了没」；点完了就把令牌存下来。

        Args: ref, actor（谁在登，落进登录态那一行）。
        """
        pending = _read_pending(await self._cache.get_json(_key(ref)))
        if pending is None:
            raise LlmLoginSessionExpired("这次登录已经过期，请重新开始")
        polled = await self._oauth.poll_device_code(
            device_auth_id=pending.device_auth_id,
            user_code=pending.user_code,
            interval_s=pending.interval_s,
        )
        if polled.grant is None:
            await self._keep(ref, pending, polled.interval_s)
            return LoginProgress(is_done=False, interval_s=polled.interval_s)
        bundle = await self._oauth.exchange_code(polled.grant)
        await self._store.save(
            pending.provider_id,
            bundle,
            auth_mode=AUTH_MODE_CHATGPT,
            actor=actor,
        )
        # ⚠ 立刻作废这次登录：句柄留着的话，同一个码能被再换一次
        await self._cache.delete(_key(ref))
        _logger.info(
            "llm_device_login_done",
            "模型账号登录成功",
            provider_id=str(pending.provider_id),
        )
        return LoginProgress(is_done=True, interval_s=polled.interval_s)

    async def _keep(self, ref: str, pending: _Pending, interval_s: int) -> None:
        """把抬高后的轮询间隔写回去。

        ⚠ 不写回的话，下一次轮询又按老间隔来，`slow_down` 于是永远不生效。
        """
        if interval_s == pending.interval_s:
            return
        await self._cache.set_json(
            _key(ref),
            _pending_json(
                pending.provider_id,
                device_auth_id=pending.device_auth_id,
                user_code=pending.user_code,
                interval_s=interval_s,
            ),
            # 剩余有效期这里拿不到，续一个够长的窗口；上游那边到点自己会拒
            ttl_s=_KEEP_TTL_S,
        )


def _key(ref: str) -> str:
    return f"{_KEY_PREFIX}:{ref}"


def _pending_json(
    provider_id: uuid.UUID,
    *,
    device_auth_id: str,
    user_code: str,
    interval_s: int,
) -> dict[str, Any]:
    """在途那一次登录存进 Redis 的形状。

    Args: provider_id, device_auth_id, user_code, interval_s。
    """
    return {
        "provider_id": str(provider_id),
        "device_auth_id": device_auth_id,
        "user_code": user_code,
        "interval_s": interval_s,
    }


def _read_pending(given: Any) -> _Pending | None:
    """读回在途那一次；读不出、或者存进去的 id 不成形时给 `None`。

    ⚠ 收窄一次而不是原样用：`isinstance` 从 `Any` narrow 出来的是
    `dict[Unknown, Unknown]`，直接读会把未知类型一路带进业务层。

    Args: given。
    """
    if not isinstance(given, dict):
        return None
    body = cast("dict[str, Any]", given)
    provider_id = _uuid_or_none(body.get("provider_id"))
    device_auth_id = body.get("device_auth_id")
    user_code = body.get("user_code")
    if not (
        provider_id is not None
        and isinstance(device_auth_id, str)
        and isinstance(user_code, str)
    ):
        return None
    interval = body.get("interval_s")
    return _Pending(
        provider_id=provider_id,
        device_auth_id=device_auth_id,
        user_code=user_code,
        interval_s=interval if isinstance(interval, int) else 5,
    )


def _uuid_or_none(given: object) -> uuid.UUID | None:
    """把存进去的那一格读回 uuid；不成形给 `None`。

    Args: given。
    """
    if not isinstance(given, str):
        return None
    try:
        return uuid.UUID(given)
    except ValueError:
        return None
