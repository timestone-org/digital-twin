"""从实例登记记录校验新会话的身份。"""

from __future__ import annotations

import asyncio
from functools import partial
from typing import TYPE_CHECKING, Final

from cryptography import x509
from cryptography.hazmat.primitives import hashes

from lib.utils.timeutils import utcnow
from opcua_server.apps.instance.crud import (
    credential_crud,
    trusted_certificate_crud,
)
from opcua_server.apps.instance.schemas.security import (
    MAX_PASSWORD_LENGTH,
    MAX_USERNAME_LENGTH,
)

if TYPE_CHECKING:
    from collections.abc import Callable
    from uuid import UUID

    from lib.auth import PasswordHasher
    from lib.db import Database
    from lib.utils.timeutils import Clock

# 每次 Argon2 需要独立内存，创建凭据和验证共用容量上限。
HASH_CONCURRENCY: Final[int] = 2


class InstanceIdentityDirectory:
    """读取实例账号与证书白名单，并在数据库事务外校验口令。"""

    def __init__(
        self,
        database: Database,
        hasher: PasswordHasher,
        *,
        clock: Clock = utcnow,
    ) -> None:
        self._database = database
        self._hasher = hasher
        self._clock = clock
        self._slots = asyncio.Semaphore(HASH_CONCURRENCY)

    async def hash_password(self, password: str) -> str:
        """生成待保存的口令散列。Args: password。"""
        return await self._offload(partial(self._hasher.hash, password))

    async def accepts_password(
        self, instance_id: UUID, username: str, password: str
    ) -> bool:
        """校验已登记的账号，并确认计算期间凭据仍然有效。

        Args: instance_id, username, password。
        """
        if not (
            0 < len(username) <= MAX_USERNAME_LENGTH
            and 0 < len(password) <= MAX_PASSWORD_LENGTH
        ):
            return False
        original = await self._credential(instance_id, username)
        if original is None:
            return False
        if not await self._offload(
            partial(self._hasher.verify, password, original[1])
        ):
            return False
        return await self._credential(instance_id, username) == original

    async def trusted_subject(
        self, instance_id: UUID, certificate: bytes
    ) -> str | None:
        """按有效期与实例指纹白名单取证书主体。

        Args: instance_id, certificate。
        """
        try:
            parsed = x509.load_der_x509_certificate(certificate)
        except ValueError:
            return None
        starts, ends = parsed.not_valid_before_utc, parsed.not_valid_after_utc
        if not starts <= self._clock() < ends:
            return None
        fingerprint = parsed.fingerprint(hashes.SHA256()).hex()
        async with self._database.session() as session:
            row = await trusted_certificate_crud.get_by_fingerprint(
                session, instance_id=instance_id, fingerprint=fingerprint
            )
            registered = (row.subject, row.expires_at) if row else None
        if registered is None:
            return None
        subject, expires_at = registered
        return (
            subject if starts <= self._clock() < min(ends, expires_at) else None
        )

    async def _credential(
        self, instance_id: UUID, username: str
    ) -> tuple[UUID, str] | None:
        async with self._database.session() as session:
            row = await credential_crud.get_by_username(
                session, instance_id=instance_id, username=username
            )
            return (row.id, row.hashed_password) if row else None

    async def _offload[T](self, operation: Callable[[], T]) -> T:
        await self._slots.acquire()
        loop = asyncio.get_running_loop()
        try:
            job = loop.run_in_executor(None, operation)
        except RuntimeError:
            self._slots.release()
            raise

        def finished(done: asyncio.Future[T]) -> None:
            self._slots.release()
            if not done.cancelled():
                done.exception()

        # 调用方取消时，已开始的 Argon2 仍占用内存，完成后才归还配额。
        job.add_done_callback(finished)
        return await asyncio.shield(job)
