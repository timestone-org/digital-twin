"""asyncua 1.1.8 的实例监听适配器，在同步会话激活前异步核验用户身份。"""

from __future__ import annotations

import asyncio
import socket
from contextlib import AbstractContextManager, nullcontext
from typing import TYPE_CHECKING, Any, Final, cast

from asyncua import Server, ua
from asyncua.common.utils import ServiceError
from asyncua.crypto import uacrypto
from asyncua.server.binary_server_asyncio import BinaryServer, OPCUAProtocol
from asyncua.server.internal_session import SessionState
from asyncua.server.uaprocessor import UaProcessor
from asyncua.ua import ua_binary

from lib.logging import get_logger
from opcua_server.apps.instance.runtime.identity import InstanceUserManager

if TYPE_CHECKING:
    from asyncua.common.utils import Buffer
    from asyncua.crypto.security_policies import SecurityPolicyFactory
    from asyncua.server.internal_session import InternalSession

    from opcua_server.apps.instance.runtime.identity import VerifiedIdentity

_logger = get_logger("opcua.identity")
IDENTITY_TIMEOUT_S: Final[float] = 3.0


async def _prepare(
    manager: InstanceUserManager, session: InternalSession, body: Buffer
) -> VerifiedIdentity:
    try:
        params = cast(
            ua.ActivateSessionParameters,
            cast(Any, ua_binary).struct_from_binary(
                ua.ActivateSessionParameters, body.copy()
            ),
        )
    except Exception:
        raise ServiceError(ua.StatusCodes.BadIdentityTokenInvalid) from None
    try:
        async with asyncio.timeout(IDENTITY_TIMEOUT_S):
            return await manager.prepare(session, params.UserIdentityToken)
    except (ServiceError, ua.UaStatusCodeError):
        raise
    except TimeoutError:
        raise ServiceError(ua.StatusCodes.BadTimeout) from None
    except Exception as error:
        _logger.warning(
            "opcua_identity_lookup_failed",
            "实例身份核验暂不可用",
            reason=type(error).__name__,
        )
        raise ServiceError(ua.StatusCodes.BadResourceUnavailable) from None


class _InstanceProcessor(UaProcessor):
    """保留上游对签名和令牌的验证，在同一次消息内提供核验结果。"""

    async def _process_message(
        self,
        typeid: ua.NodeId,
        requesthdr: ua.RequestHeader,
        seqhdr: ua.SequenceHeader,
        body: Buffer,
    ) -> bool | None:
        scope: AbstractContextManager[None] = nullcontext()
        session = cast(Any, self).session
        is_activation = typeid == ua.NodeId(
            ua.Int32(ua.ObjectIds.ActivateSessionRequest_Encoding_DefaultBinary)
        )
        if (
            is_activation
            and session is not None
            and session.state == SessionState.Created
        ):
            manager = session.iserver.user_manager
            if not isinstance(manager, InstanceUserManager):
                raise ServiceError(ua.StatusCodes.BadUserAccessDenied)
            identity = await _prepare(manager, session, body)
            scope = manager.grant(session, identity)
        with scope:
            parent = cast(Any, super())
            dispatch = parent._process_message  # noqa: SLF001  # asyncua hook
            return cast(
                bool | None, await dispatch(typeid, requesthdr, seqhdr, body)
            )


class _InstanceProtocol(OPCUAProtocol):
    """为本连接建立实例消息处理器。"""

    def connection_made(self, transport: asyncio.BaseTransport) -> None:
        own = cast(Any, self)
        own.peer_name = transport.get_extra_info("peername")
        own.transport = transport
        own.processor = _InstanceProcessor(own.iserver, transport, own.limits)
        cast(Any, own.processor).set_policies(own.policies)
        own.iserver.asyncio_transports.append(transport)
        own.clients.append(self)
        self._task = asyncio.create_task(self._process_received_message_loop())


class _InstanceBinaryServer(BinaryServer):
    """使用实例协议工厂，连接清理沿用 BinaryServer。"""

    _policies: list[SecurityPolicyFactory]

    def _make_protocol(self) -> _InstanceProtocol:
        own = cast(Any, self)
        return _InstanceProtocol(
            own.iserver,
            self._policies,
            own.clients,
            own.closing_tasks,
            own.limits,
        )


class InstanceServer(Server):
    """用带异步身份核验的监听器启动标准地址空间。"""

    _policies: list[SecurityPolicyFactory]

    async def start(self) -> None:
        """启动地址空间与监听器，监听启动失败时关闭地址空间。"""
        own = cast(Any, self)
        internal = own.iserver
        if internal.certificate is not None:
            uacrypto.check_certificate(
                internal.certificate,
                self._application_uri,
                socket.gethostname(),
            )
        await self._setup_server_nodes()
        await internal.start()
        try:
            host, port = self._get_bind_socket_info()
            listener = _InstanceBinaryServer(internal, host, port, own.limits)
            own.bserver = listener
            cast(Any, listener).set_policies(self._policies)
            await listener.start()
        except (Exception, asyncio.CancelledError):
            await internal.stop()
            raise
