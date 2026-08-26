"""模型凭据的读写与自动刷新。

⚠ 刷新是**单飞**的：多个副本同时发现令牌过期时，只让一个去换，其余的等一小会儿
再读库。各刷各的话，每一份新令牌都会把上一份顶掉，而被顶掉的那些已经发出去用了。

⚠ 锁里确实有一次网络往返。这不违反「锁内禁长 IO」的用意：那一跳有 10 秒硬超时、
锁的 TTL 比它长，且**等锁的人不排队**——拿不到锁就去读库，读不到新的就拿手上
这份去试。最坏情况是一次多余的 401，而不是一串挂住的请求。

⚠ 刷新被拒（refresh_token 作废）不删行：删了的话界面上是「从来没登录过」，
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

from ai_assistant.apps.credential.crud import credential_crud
from ai_assistant.apps.credential.errors import (
    CredentialNotFound,
    LoginRejected,
)
from ai_assistant.apps.credential.models import ModelCredential
from ai_assistant.apps.credential.services.oauth_client import OAuthClient
from ai_assistant.apps.credential.services.tokens import TokenBundle
from lib.cache import CacheLike
from lib.crypto import SecretCipher
from lib.logging import get_logger

_logger = get_logger("assistant.credential")

SessionFactory = Callable[[], AbstractAsyncContextManager[AsyncSession]]

# 提前多少秒就认为该换了。⚠ 要大于一次模型调用的时长：正好卡在边界上换的话，
# 一次长回答会在中途拿着过期令牌撞 401
REFRESH_SKEW_S = 300
# 刷新锁的存活时间，必须长于一次刷新往返
REFRESH_LOCK_TTL_S = 15
# 没拿到锁的人等多久再读库
REFRESH_WAIT_S = 1.0
# 账号标识只留尾巴，前面打码
ACCOUNT_TAIL_CHARS = 6


@dataclass(frozen=True)
class CredentialStatus:
    """界面上要显示的那几格。⚠ 令牌本身一个字都不在里面。"""

    provider: str
    is_connected: bool
    account_label: str | None = None
    plan_label: str | None = None
    expires_at: dt.datetime | None = None
    last_refresh_at: dt.datetime | None = None
    last_error: str | None = None


class CredentialStore:
    """一路模型的登录态：读、写、忘掉，以及到期自动换。"""

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

    async def status(self, provider: str) -> CredentialStatus:
        """这一路登没登录、挂的是哪个账号。

        Args: provider。
        """
        async with self._sessions() as session:
            row = await credential_crud.by_provider(session, provider)
            if row is None:
                return CredentialStatus(provider=provider, is_connected=False)
            return CredentialStatus(
                provider=provider,
                is_connected=True,
                account_label=row.account_label,
                plan_label=row.plan_label,
                expires_at=row.expires_at,
                last_refresh_at=row.last_refresh_at,
                last_error=row.last_error,
            )

    async def save(
        self,
        provider: str,
        bundle: TokenBundle,
        *,
        auth_mode: str,
        actor_id: uuid.UUID | None,
    ) -> None:
        """写进去；已经有一行就整行换掉。

        Args: provider, bundle, auth_mode, actor_id。
        """
        async with self._sessions() as session:
            row = await credential_crud.by_provider_for_update(
                session, provider
            )
            if row is None:
                row = ModelCredential(provider=provider, auth_mode=auth_mode)
                session.add(row)
            _apply(
                row,
                bundle,
                cipher=self._cipher,
                auth_mode=auth_mode,
                actor_id=actor_id,
            )

    async def forget(self, provider: str) -> bool:
        """退出登录。返回本来有没有登录过。

        Args: provider。
        """
        async with self._sessions() as session:
            row = await credential_crud.by_provider_for_update(
                session, provider
            )
            if row is None:
                return False
            await session.delete(row)
            return True

    async def access_token(self, provider: str) -> str:
        """取一个此刻能用的访问令牌，必要时先换一份新的。

        Args: provider。
        """
        bundle = await self._bundle(provider)
        if bundle is None:
            raise CredentialNotFound("这一路模型还没登录，去系统页登录一次")
        if not bundle.is_stale(skew_s=REFRESH_SKEW_S):
            return bundle.access_token
        return (await self._refreshed(provider, bundle)).access_token

    async def _bundle(self, provider: str) -> TokenBundle | None:
        async with self._sessions() as session:
            row = await credential_crud.by_provider(session, provider)
            if row is None:
                return None
            return TokenBundle.from_cipher_text(row.token_enc, self._cipher)

    async def _refreshed(
        self, provider: str, stale: TokenBundle
    ) -> TokenBundle:
        key = f"credential-refresh:{provider}"
        holder = secrets.token_hex(8)
        if not await self._cache.set_if_absent(
            key, holder, ttl_s=REFRESH_LOCK_TTL_S
        ):
            return await self._waited(provider, stale)
        try:
            fresh = await self._oauth.refresh(stale.refresh_token)
        except LoginRejected as error:
            await self._mark_failed(provider, str(error))
            raise
        await self.save(provider, fresh, auth_mode="chatgpt", actor_id=None)
        _logger.info(
            "credential_refreshed", "模型凭据已续期", provider=provider
        )
        await self._cache.delete_if_owner(key, holder)
        return fresh

    async def _waited(self, provider: str, stale: TokenBundle) -> TokenBundle:
        """别人正在换：等一下读库，读不到新的就拿手上这份去试。"""
        await asyncio.sleep(REFRESH_WAIT_S)
        fresh = await self._bundle(provider)
        if fresh is not None and not fresh.is_stale(skew_s=0):
            return fresh
        return stale

    async def _mark_failed(self, provider: str, reason: str) -> None:
        async with self._sessions() as session:
            row = await credential_crud.by_provider_for_update(
                session, provider
            )
            if row is None:
                return
            row.last_error = reason
            row.row_version = _next_version(row.row_version)


def _apply(
    row: ModelCredential,
    bundle: TokenBundle,
    *,
    cipher: SecretCipher,
    auth_mode: str,
    actor_id: uuid.UUID | None,
) -> None:
    """把一份令牌包写进行里。

    Args: row, bundle, cipher, auth_mode, actor_id。
    """
    row.auth_mode = auth_mode
    row.token_enc = bundle.to_cipher_text(cipher)
    row.account_label = masked(bundle.account_id)
    row.plan_label = bundle.plan_type
    row.expires_at = bundle.expires_at
    row.last_refresh_at = dt.datetime.now(dt.UTC)
    row.last_error = None
    if actor_id is not None:
        row.updated_by = actor_id
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
