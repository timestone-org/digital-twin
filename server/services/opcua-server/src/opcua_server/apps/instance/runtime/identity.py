"""将一次异步核验的实例身份交给 asyncua 的同步会话激活回调。"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import secrets
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Literal, Protocol, cast

from asyncua import ua
from asyncua.common.utils import ServiceError
from asyncua.crypto.permission_rules import User, UserRole
from asyncua.server.user_managers import UserManager

if TYPE_CHECKING:
    from collections.abc import Generator
    from uuid import UUID

    from asyncua.server.internal_session import InternalSession


class IdentityDirectory(Protocol):
    """实例身份的持久核验接口。"""

    async def accepts_password(
        self, instance_id: UUID, username: str, password: str
    ) -> bool: ...

    async def trusted_subject(
        self, instance_id: UUID, certificate: bytes
    ) -> str | None: ...


@dataclass(frozen=True, slots=True)
class VerifiedIdentity:
    """仅限本次激活的核验结果。"""

    kind: Literal["anonymous", "username", "certificate"]
    name: str | None = field(default=None, repr=False)
    proof: bytes = field(default=b"", repr=False)


@dataclass(slots=True)
class _Activation:
    session: InternalSession
    task: object
    identity: VerifiedIdentity | None


class InstanceUserManager(UserManager):
    """按实例核验新连接，授权只在当前激活调用内有效。"""

    def __init__(
        self,
        instance_id: UUID | None = None,
        directory: IdentityDirectory | None = None,
    ) -> None:
        self._instance_id = instance_id
        self._directory = directory
        self._tag_key = secrets.token_bytes(32)
        self._verified: ContextVar[_Activation | None] = ContextVar(
            "opcua_verified_identity", default=None
        )

    def get_user(
        self,
        iserver: object,
        username: str | None = None,
        password: str | None = None,
        certificate: bytes | None = None,
    ) -> User | None:
        """核对本次令牌并返回普通客户端身份。

        Args: iserver, username, password, certificate。
        """
        identity = self._consume(iserver)
        if identity is None:
            return None
        if identity.kind == "username":
            if username != identity.name or password is None:
                return None
            if not hmac.compare_digest(
                identity.proof, self._password_tag(password)
            ):
                return None
        elif username is not None or password is not None:
            return None
        elif identity.kind == "certificate":
            if not certificate or not hmac.compare_digest(
                identity.proof, hashlib.sha256(certificate).digest()
            ):
                return None
        return User(role=UserRole.User)

    def _consume(self, iserver: object) -> VerifiedIdentity | None:
        bound = self._verified.get()
        if bound is None or cast(Any, bound.session).iserver is not iserver:
            return None
        if bound.task is not asyncio.current_task():
            return None
        identity, bound.identity = bound.identity, None
        return identity

    def identity_for(self, session: InternalSession) -> VerifiedIdentity | None:
        """取当前任务在本次会话激活中已核验的身份。Args: session。"""
        bound = self._verified.get()
        if (
            bound is None
            or bound.session is not session
            or bound.task is not asyncio.current_task()
        ):
            return None
        return bound.identity

    @contextmanager
    def grant(
        self, session: InternalSession, identity: VerifiedIdentity
    ) -> Generator[None, None, None]:
        """在上游核验期间提供绑定当前会话的一次性结果。

        Args: session, identity。
        """
        active = _Activation(session, asyncio.current_task(), identity)
        mark = self._verified.set(active)
        try:
            yield
        finally:
            active.identity = None
            self._verified.reset(mark)

    async def prepare(
        self, session: InternalSession, token: object
    ) -> VerifiedIdentity:
        """验证本次请求显式提交的用户令牌。

        Args: session, token。
        """
        owner = cast(Any, session).iserver
        if isinstance(token, ua.ExtensionObject) and token.TypeId == ua.NodeId(
            ua.Int32(ua.ObjectIds.Null)
        ):
            token = ua.AnonymousIdentityToken()
        if not isinstance(
            token, cast(tuple[type[object], ...], owner.supported_tokens)
        ):
            raise ServiceError(ua.StatusCodes.BadIdentityTokenRejected)
        if isinstance(token, ua.AnonymousIdentityToken):
            return VerifiedIdentity("anonymous")
        if isinstance(token, ua.UserNameIdentityToken):
            return await self._username(session, token)
        if isinstance(token, ua.X509IdentityToken):
            return await self._certificate(token.CertificateData)
        raise ServiceError(ua.StatusCodes.BadIdentityTokenRejected)

    async def _username(
        self, session: InternalSession, token: ua.UserNameIdentityToken
    ) -> VerifiedIdentity:
        try:
            username, password = cast(Any, session).iserver.decrypt_user_token(
                session, token
            )
        except (ServiceError, ua.UaStatusCodeError):
            raise
        except Exception:
            raise ServiceError(ua.StatusCodes.BadIdentityTokenInvalid) from None
        if (
            self._directory is None
            or self._instance_id is None
            or not isinstance(username, str)
            or not isinstance(password, str)
            or not username
            or not password
        ):
            raise ServiceError(ua.StatusCodes.BadUserAccessDenied)
        if not await self._directory.accepts_password(
            self._instance_id, username, password
        ):
            raise ServiceError(ua.StatusCodes.BadUserAccessDenied)
        return VerifiedIdentity(
            "username", username, self._password_tag(password)
        )

    async def _certificate(self, der: bytes | None) -> VerifiedIdentity:
        if not der or self._directory is None or self._instance_id is None:
            raise ServiceError(ua.StatusCodes.BadUserAccessDenied)
        name = await self._directory.trusted_subject(self._instance_id, der)
        if name is None:
            raise ServiceError(ua.StatusCodes.BadUserAccessDenied)
        return VerifiedIdentity(
            "certificate", name, hashlib.sha256(der).digest()
        )

    def _password_tag(self, password: str) -> bytes:
        return hmac.digest(self._tag_key, password.encode("utf-8"), "sha256")
