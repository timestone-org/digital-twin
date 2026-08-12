"""上位机身份：会话查询、实例凭据、客户端信任证书。

⚠ 这一层的「用户」是上位机，不是平台的人类用户（CONTEXT.md §7）。

⚠ 明文口令只在创建时返回一次，库里只有 argon2id 散列。丢了只能重置——
「找回口令」这个功能在这里不存在，也不该存在。
"""

import secrets
import uuid
from datetime import UTC, datetime

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import PasswordHasher
from lib.db import Database
from opcua_server.apps.instance.crud import (
    credential_crud,
    instance_crud,
    trusted_certificate_crud,
)
from opcua_server.apps.instance.errors import (
    CredentialNotFound,
    InstanceNotFound,
    TrustedCertificateInvalid,
)
from opcua_server.apps.instance.models import Credential, TrustedCertificate
from opcua_server.apps.instance.runtime.supervisor import InstanceSupervisor
from opcua_server.apps.instance.schemas import (
    CredentialCreatedOut,
    CredentialCreateIn,
    CredentialOut,
    SessionOut,
    TrustedCertificateCreateIn,
    TrustedCertificateOut,
)

# 自动生成的口令长度（URL-safe 字符），足以顶住离线爆破
GENERATED_PASSWORD_BYTES = 24
_PRIVATE_KEY_MARKER = "PRIVATE KEY"


class SecurityService:
    """上位机身份面的业务与事务边界。"""

    def __init__(
        self,
        *,
        database: Database,
        supervisor: InstanceSupervisor,
        hasher: PasswordHasher,
    ) -> None:
        """按数据库、实例管理器与散列器装配。

        Args: database, supervisor, hasher。
        """
        self._database = database
        self._supervisor = supervisor
        self._hasher = hasher

    async def list_sessions(self, instance_id: uuid.UUID) -> list[SessionOut]:
        """列出在线会话。

        ⚠ 会话是**运行时**的东西，库里没有。实例没在跑就是空表，
        而不是「查不到」——两者对调用方的含义不同。

        Args: instance_id。
        """
        async with self._database.session() as session:
            await self._require_instance(session, instance_id)
        running = self._supervisor.find(instance_id)
        if running is None:
            return []
        return [
            SessionOut(
                session_id=record.session_id,
                peer=record.peer,
                username=record.username,
                connected_at=record.connected_at,
            )
            for record in running.sessions()
        ]

    async def list_credentials(
        self, instance_id: uuid.UUID
    ) -> list[CredentialOut]:
        """列出实例凭据。散列不出现在出参里。

        Args: instance_id。
        """
        async with self._database.session() as session:
            await self._require_instance(session, instance_id)
            rows = await credential_crud.list_of_instance(session, instance_id)
            return [CredentialOut.model_validate(row) for row in rows]

    async def create_credential(
        self, instance_id: uuid.UUID, payload: CredentialCreateIn
    ) -> CredentialCreatedOut:
        """建实例凭据。不给口令就生成一个。

        Args: instance_id, payload。
        """
        password = payload.password or secrets.token_urlsafe(
            GENERATED_PASSWORD_BYTES
        )
        async with self._database.session() as session:
            await self._require_instance(session, instance_id)
            row = Credential(
                instance_id=instance_id,
                username=payload.username,
                hashed_password=self._hasher.hash(password),
            )
            credential_crud.add(session, row)
            await session.flush()
            await session.refresh(row)
            return CredentialCreatedOut(
                credential=CredentialOut.model_validate(row),
                password=password,
            )

    async def delete_credential(
        self, instance_id: uuid.UUID, credential_id: uuid.UUID
    ) -> None:
        """删实例凭据。

        Args: instance_id, credential_id。
        """
        async with self._database.session() as session:
            row = await credential_crud.get(session, credential_id)
            if row is None or row.instance_id != instance_id:
                raise CredentialNotFound("凭据不存在于该实例")
            await credential_crud.delete(session, row)

    async def list_certificates(
        self, instance_id: uuid.UUID
    ) -> list[TrustedCertificateOut]:
        """列出信任的客户端证书。

        Args: instance_id。
        """
        async with self._database.session() as session:
            await self._require_instance(session, instance_id)
            rows = await trusted_certificate_crud.list_of_instance(
                session, instance_id
            )
            return [TrustedCertificateOut.model_validate(row) for row in rows]

    async def add_certificate(
        self, instance_id: uuid.UUID, payload: TrustedCertificateCreateIn
    ) -> TrustedCertificateOut:
        """按指纹登记一张客户端证书。

        ⚠ 带私钥的输入一律拒绝，且在解析之前就拒——库里出现私钥意味着它会
        随数据库备份外流（不变式 7）。数据库那条 CHECK 是第二道防线。

        Args: instance_id, payload。
        """
        parsed = _parse_certificate(payload.certificate_pem)
        async with self._database.session() as session:
            await self._require_instance(session, instance_id)
            row = TrustedCertificate(
                instance_id=instance_id,
                fingerprint=parsed.fingerprint,
                subject=parsed.subject,
                expires_at=parsed.expires_at,
                public_key_pem=parsed.public_key_pem,
            )
            trusted_certificate_crud.add(session, row)
            await session.flush()
            await session.refresh(row)
            return TrustedCertificateOut.model_validate(row)

    async def delete_certificate(
        self, instance_id: uuid.UUID, certificate_id: uuid.UUID
    ) -> None:
        """撤销一张信任证书。

        Args: instance_id, certificate_id。
        """
        async with self._database.session() as session:
            row = await trusted_certificate_crud.get(session, certificate_id)
            if row is None or row.instance_id != instance_id:
                raise TrustedCertificateInvalid("证书不存在于该实例")
            await trusted_certificate_crud.delete(session, row)

    @staticmethod
    async def _require_instance(
        session: AsyncSession, instance_id: uuid.UUID
    ) -> None:
        if await instance_crud.get(session, instance_id) is None:
            raise InstanceNotFound("实例不存在")


class _ParsedCertificate:
    """解析出来的证书摘要。只有可入库的部分。"""

    def __init__(
        self,
        *,
        fingerprint: str,
        subject: str,
        expires_at: datetime,
        public_key_pem: str,
    ) -> None:
        self.fingerprint = fingerprint
        self.subject = subject
        self.expires_at = expires_at
        self.public_key_pem = public_key_pem


def _parse_certificate(pem: str) -> _ParsedCertificate:
    """解析 PEM 证书，取指纹、主体与有效期末。

    Args: pem。
    """
    if _PRIVATE_KEY_MARKER in pem:
        raise TrustedCertificateInvalid("只接受公钥证书，输入里含私钥")
    try:
        certificate = x509.load_pem_x509_certificate(pem.encode("utf-8"))
    except ValueError as error:
        raise TrustedCertificateInvalid("证书无法解析") from error
    digest = certificate.fingerprint(hashes.SHA256()).hex()
    public_pem = certificate.public_bytes(serialization.Encoding.PEM)
    return _ParsedCertificate(
        fingerprint=digest,
        subject=certificate.subject.rfc4514_string(),
        expires_at=certificate.not_valid_after_utc.astimezone(UTC),
        public_key_pem=public_pem.decode("ascii"),
    )
