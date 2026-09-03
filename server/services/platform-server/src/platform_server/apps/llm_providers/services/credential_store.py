"""订阅账号登录态的读写与自动续期。属主只有这一处（ADR-0041）。

⚠ 续期是**单飞**的：多个副本同时发现令牌过期时，只让一个去换，其余的等一小会儿
再读库。各刷各的话，每一份新令牌都会把上一份顶掉，而被顶掉的那些已经发出去用了。

⚠ 锁里确实有一次网络往返。这不违反「锁内禁长 IO」的用意：那一跳有 10 秒硬超时、
锁的 TTL 比它长，且**等锁的人不排队**——拿不到锁就去读库，读不到新的就拿手上
这份去试。最坏情况是一次多余的 401，而不是一串挂住的请求。

⚠ 上游那一跳**不在事务里**：读一次、出了事务再去换、换回来另开一个事务写
（database-standard §6：禁事务内做外部 IO）。

⚠ 续期被拒（refresh_token 作废）不删行：删了的话界面上是「从来没登录过」，
而真实情况是「登录过、需要重新来一次」——后者要告诉人，前者不用。
"""

import asyncio
import datetime as dt
import secrets
import uuid
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from lib.cache import CacheLike
from lib.crypto import SecretCipher
from lib.logging import get_logger
from platform_server.apps.llm_providers import crud
from platform_server.apps.llm_providers.enums import AUTH_MODE_CHATGPT
from platform_server.apps.llm_providers.errors import (
    LlmCredentialNotFound,
    LlmCredentialStale,
    LlmLoginRejected,
)
from platform_server.apps.llm_providers.models import LlmProviderCredential
from platform_server.apps.llm_providers.services.oauth_client import OAuthClient
from platform_server.apps.llm_providers.services.tokens import TokenBundle

_logger = get_logger("platform.llm_providers.credential")

SessionFactory = Callable[[], AbstractAsyncContextManager[AsyncSession]]

# 提前多少秒就认为该换了。⚠ 要大于一次模型调用的时长：正好卡在边界上换的话，
# 一次长回答会在中途拿着过期令牌撞 401
REFRESH_SKEW_S = 300
# 续期锁的存活时间，必须长于一次续期往返
REFRESH_LOCK_TTL_S = 15
# 没拿到锁的人等多久再读库
REFRESH_WAIT_S = 1.0
# 账号标识只留尾巴，前面打码
ACCOUNT_TAIL_CHARS = 6


@dataclass(frozen=True)
class LeasedToken:
    """下发给消费方的那一份。

    ⚠ 只有这几格出得了这一层：refresh_token 一个字都不该离开，而消费方要的
    恰好也只有访问令牌与账号标识（后者进请求头）。
    """

    access_token: str
    expires_at: dt.datetime
    account_id: str | None
    plan_type: str | None


@dataclass(frozen=True)
class CredentialStatus:
    """界面上要显示的那几格。⚠ 令牌本身一个字都不在里面。"""

    provider_id: uuid.UUID
    is_connected: bool
    account_label: str | None = None
    plan_label: str | None = None
    expires_at: dt.datetime | None = None
    last_refresh_at: dt.datetime | None = None
    last_error: str | None = None


class CredentialStore:
    """一路供应商的登录态：读、写、忘掉，以及到期自动换。"""

    def __init__(
        self,
        *,
        sessions: SessionFactory,
        cipher: SecretCipher,
        oauth: OAuthClient,
        cache: CacheLike,
    ) -> None:
        """Args: sessions, cipher, oauth, cache。"""
        self._sessions = sessions
        self._cipher = cipher
        self._oauth = oauth
        self._cache = cache

    async def status(self, provider_id: uuid.UUID) -> CredentialStatus:
        """这一路登没登录、挂的是哪个账号。

        Args: provider_id。
        """
        async with self._sessions() as session:
            row = await crud.credential.by_provider(session, provider_id)
            if row is None:
                return CredentialStatus(
                    provider_id=provider_id, is_connected=False
                )
            return CredentialStatus(
                provider_id=provider_id,
                is_connected=True,
                account_label=row.account_label,
                plan_label=row.plan_label,
                expires_at=row.expires_at,
                last_refresh_at=row.last_refresh_at,
                last_error=row.last_error,
            )

    async def save(
        self,
        provider_id: uuid.UUID,
        bundle: TokenBundle,
        *,
        auth_mode: str,
        actor: str | None,
    ) -> None:
        """写进去；已经有一行就整行换掉。

        Args: provider_id, bundle, auth_mode, actor。
        """
        async with self._sessions() as session:
            row = await crud.credential.by_provider_for_update(
                session, provider_id
            )
            if row is None:
                row = crud.credential.add(
                    session,
                    LlmProviderCredential(
                        provider_id=provider_id, auth_mode=auth_mode
                    ),
                )
            _apply(
                row,
                bundle,
                cipher=self._cipher,
                auth_mode=auth_mode,
                actor=actor,
            )

    async def forget(self, provider_id: uuid.UUID) -> bool:
        """退出登录。返回本来有没有登录过。

        Args: provider_id。
        """
        async with self._sessions() as session:
            row = await crud.credential.by_provider_for_update(
                session, provider_id
            )
            if row is None:
                return False
            await session.delete(row)
            return True

    async def lease(self, provider_id: uuid.UUID) -> LeasedToken:
        """下发一份此刻能用的令牌，必要时先换一份新的。

        Args: provider_id。
        """
        bundle = await self._bundle(provider_id)
        if bundle.is_stale(skew_s=REFRESH_SKEW_S):
            bundle = await self._refreshed(provider_id, bundle)
        return LeasedToken(
            access_token=bundle.access_token,
            expires_at=bundle.expires_at,
            account_id=bundle.account_id,
            plan_type=bundle.plan_type,
        )

    async def _bundle(self, provider_id: uuid.UUID) -> TokenBundle:
        """库里那一份。没登录过、或密文解不开时分两档抛。"""
        async with self._sessions() as session:
            row = await crud.credential.by_provider(session, provider_id)
            if row is None:
                raise LlmCredentialNotFound(
                    "这一路订阅账号还没登录，去模型管理页登录一次"
                )
            found = TokenBundle.from_cipher_text(row.token_enc, self._cipher)
        if found is None:
            # 换过加密密钥的部署会走到这里：行还在，但那一份再也解不开了
            raise LlmCredentialStale(
                "这一路订阅账号的登录已失效，去模型管理页重新登录一次"
            )
        return found

    async def _refreshed(
        self, provider_id: uuid.UUID, stale: TokenBundle
    ) -> TokenBundle:
        key = f"llm-credential-refresh:{provider_id}"
        holder = secrets.token_hex(8)
        if not await self._cache.set_if_absent(
            key, holder, ttl_s=REFRESH_LOCK_TTL_S
        ):
            return await self._waited(provider_id, stale)
        try:
            fresh = await self._oauth.refresh(stale.refresh_token)
        except LlmLoginRejected as error:
            await self._mark_failed(provider_id, str(error))
            raise LlmCredentialStale(
                "这一路订阅账号的登录已失效，去模型管理页重新登录一次"
            ) from error
        await self.save(
            provider_id, fresh, auth_mode=AUTH_MODE_CHATGPT, actor=None
        )
        _logger.info(
            "llm_credential_refreshed",
            "模型账号凭据已续期",
            provider_id=str(provider_id),
        )
        await self._cache.delete_if_owner(key, holder)
        return fresh

    async def _waited(
        self, provider_id: uuid.UUID, stale: TokenBundle
    ) -> TokenBundle:
        """别人正在换：等一下读库，读不到新的就拿手上这份去试。"""
        await asyncio.sleep(REFRESH_WAIT_S)
        async with self._sessions() as session:
            row = await crud.credential.by_provider(session, provider_id)
            fresh = (
                None
                if row is None
                else TokenBundle.from_cipher_text(row.token_enc, self._cipher)
            )
        if fresh is not None and not fresh.is_stale(skew_s=0):
            return fresh
        return stale

    async def _mark_failed(self, provider_id: uuid.UUID, reason: str) -> None:
        async with self._sessions() as session:
            row = await crud.credential.by_provider_for_update(
                session, provider_id
            )
            if row is None:
                return
            row.last_error = reason
            row.row_version = _next_version(row.row_version)


def _apply(
    row: LlmProviderCredential,
    bundle: TokenBundle,
    *,
    cipher: SecretCipher,
    auth_mode: str,
    actor: str | None,
) -> None:
    """把一份令牌包写进行里。

    Args: row, bundle, cipher, auth_mode, actor。
    """
    row.auth_mode = auth_mode
    row.token_enc = bundle.to_cipher_text(cipher)
    row.account_label = masked(bundle.account_id)
    row.plan_label = bundle.plan_type
    row.expires_at = bundle.expires_at
    row.last_refresh_at = dt.datetime.now(dt.UTC)
    row.last_error = None
    if actor is not None:
        row.updated_by = actor
    row.row_version = _next_version(row.row_version)


def _next_version(current: int | None) -> int:
    """行版本推一格。

    ⚠ 新行上它是 `None` 而不是 1：默认值写在**服务端**（`server_default`），
    flush 之前 Python 这一侧根本没有值。直接 `+= 1` 会在「第一次登录」这条路上
    炸掉，而那条路只有对着真库跑才走得到。

    Args: current。
    """
    return (current or 0) + 1


def masked(account_id: str | None) -> str | None:
    """账号标识只留尾巴。⚠ 它是 PII，而界面上只需要回答「是不是我那个号」。

    Args: account_id。
    """
    if account_id is None or account_id == "":
        return None
    if len(account_id) <= ACCOUNT_TAIL_CHARS:
        return account_id
    return f"…{account_id[-ACCOUNT_TAIL_CHARS:]}"
