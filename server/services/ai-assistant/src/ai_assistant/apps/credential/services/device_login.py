"""设备码登录的两步：开个头、问一次好了没。

⚠ 轮询由**浏览器**驱动，服务端不起后台任务：api 角色是无状态的，第二次轮询
可能落到另一个副本上；起后台任务的话，那个副本上的任务在关停时被 drain 掉，
而用户看到的是「一直转圈」。

⚠ `device_code` 与 PKCE 的 verifier 是密钥态，**一个字都不下发**：交给浏览器的
只是一个不可猜的句柄。它们连同轮询间隔一起放 Redis，TTL 就是上游给的有效期——
过期即消失，不用自己清。
"""

import secrets
import uuid
from dataclasses import dataclass
from typing import Any, Protocol, cast

from ai_assistant.apps.credential.errors import LoginSessionExpired
from ai_assistant.apps.credential.services.oauth_client import (
    OAuthClient,
    make_pkce_pair,
)
from ai_assistant.apps.credential.services.tokens import TokenBundle
from lib.cache import CacheLike
from lib.logging import get_logger

_logger = get_logger("assistant.credential.login")

# Redis 键前缀。⚠ 带服务名以外还带用途：共用一个 Redis 的两个用途撞上同一个
# 句柄时，会互相读到对方的东西
_KEY_PREFIX = "assistant:device-login"
# 句柄的字节数。它是这次登录的唯一凭证，短了就能被猜
_REF_BYTES = 24


class CredentialSink(Protocol):
    """登录成功之后把令牌交给谁。

    ⚠ 收窄成一个方法而不是收整个 `CredentialStore`：这一层只会「存一份」，
    而把整个读写面接进来之后，用例要为它准备一整套数据库。
    """

    async def save(
        self,
        provider: str,
        bundle: TokenBundle,
        *,
        auth_mode: str,
        actor_id: uuid.UUID | None,
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

    async def start(self, provider: str) -> LoginStarted:
        """要一个用户码与验证地址。

        Args: provider。
        """
        verifier, challenge = make_pkce_pair()
        started = await self._oauth.start_device_code(challenge)
        ref = secrets.token_urlsafe(_REF_BYTES)
        await self._cache.set_json(
            _key(ref),
            {
                "provider": provider,
                "device_code": started.device_code,
                "verifier": verifier,
                "interval_s": started.interval_s,
            },
            ttl_s=started.expires_in_s,
        )
        _logger.info(
            "device_login_started", "设备码登录已开始", provider=provider
        )
        return LoginStarted(
            ref=ref,
            user_code=started.user_code,
            verification_uri=started.verification_uri,
            interval_s=started.interval_s,
            expires_in_s=started.expires_in_s,
        )

    async def poll(self, ref: str, *, actor_id: uuid.UUID) -> LoginProgress:
        """问一次「用户点完了没」；点完了就把令牌存下来。

        Args: ref, actor_id（谁在登，落进凭据行）。
        """
        pending = _read_pending(await self._cache.get_json(_key(ref)))
        if pending is None:
            raise LoginSessionExpired("这次登录已经过期，请重新开始")
        polled = await self._oauth.poll_device_code(
            pending.device_code, pending.interval_s
        )
        if polled.authorization_code is None:
            await self._keep(ref, pending, polled.interval_s)
            return LoginProgress(is_done=False, interval_s=polled.interval_s)
        bundle = await self._oauth.exchange_code(
            polled.authorization_code, pending.verifier
        )
        await self._store.save(
            pending.provider,
            bundle,
            auth_mode="chatgpt",
            actor_id=actor_id,
        )
        # ⚠ 立刻作废这次登录：句柄留着的话，同一个码能被再换一次
        await self._cache.delete(_key(ref))
        _logger.info(
            "device_login_done",
            "模型账号登录成功",
            provider=pending.provider,
        )
        return LoginProgress(is_done=True, interval_s=polled.interval_s)

    async def _keep(
        self, ref: str, pending: "_Pending", interval_s: int
    ) -> None:
        """把抬高后的轮询间隔写回去。

        ⚠ 不写回的话，下一次轮询又按老间隔来，`slow_down` 于是永远不生效。
        """
        if interval_s == pending.interval_s:
            return
        await self._cache.set_json(
            _key(ref),
            {
                "provider": pending.provider,
                "device_code": pending.device_code,
                "verifier": pending.verifier,
                "interval_s": interval_s,
            },
            # 剩余有效期这里拿不到，续一个够长的窗口；上游那边到点自己会拒
            ttl_s=_KEEP_TTL_S,
        )


# 抬高间隔后续多久。⚠ 比上游的码有效期长没关系：真过期了上游会回 expired_token
_KEEP_TTL_S = 900


@dataclass(frozen=True)
class _Pending:
    provider: str
    device_code: str
    verifier: str
    interval_s: int


def _key(ref: str) -> str:
    return f"{_KEY_PREFIX}:{ref}"


def _read_pending(given: Any) -> _Pending | None:
    if not isinstance(given, dict):
        return None
    # ⚠ 收窄一次而不是原样用：`isinstance` 从 `Any` narrow 出来的是
    # `dict[Unknown, Unknown]`，直接读会把未知类型一路带进业务层
    body = cast("dict[str, Any]", given)
    provider = body.get("provider")
    device_code = body.get("device_code")
    verifier = body.get("verifier")
    if not (
        isinstance(provider, str)
        and isinstance(device_code, str)
        and isinstance(verifier, str)
    ):
        return None
    interval = body.get("interval_s")
    return _Pending(
        provider=provider,
        device_code=device_code,
        verifier=verifier,
        interval_s=interval if isinstance(interval, int) else 5,
    )
