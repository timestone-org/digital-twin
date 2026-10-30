"""建模写命令的请求指纹与持久执行装配。"""

from datetime import datetime

from fastapi import Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.errors import ValidationFailed
from lib.utils.timeutils import utcnow
from platform_server.apps.modeling.services.command_gate import (
    DurableModelingGate,
)
from platform_server.apps.modeling.services.command_policy import fingerprint
from platform_server.apps.modeling.services.operator_audit import (
    OperatorIdentity,
    resolve_operator,
)
from platform_server.apps.modeling.services.sessions import Sessions
from platform_server.deps import WriteGate, get_container


def get_command_now() -> datetime:
    return utcnow()


def get_operator_identity(
    request: Request, caller: CallerContext
) -> OperatorIdentity:
    headers = request.headers.getlist("X-Modeling-Operator-Id")
    if len(headers) > 1:
        raise ValidationFailed("外部操作者标识只能提交一次")
    return resolve_operator(
        caller,
        headers[0] if headers else None,
        get_container(request).settings.modeling_trusted_operator_accounts,
        request.client.host if request.client else None,
    )


async def build_command_gate(
    request: Request,
    response: Response,
    session: AsyncSession,
    base: WriteGate,
    sessions: Sessions,
) -> DurableModelingGate:
    identity = get_operator_identity(request, base.caller)
    return DurableModelingGate(
        idempotency=base.idempotency,
        idempotency_key=base.idempotency_key,
        caller=base.caller,
        session=session,
        sessions=sessions,
        request_hash=fingerprint(
            request.method,
            request.url.path,
            await request.body(),
            identity.external_operator_id,
        ),
        on_command=lambda command_id: response.headers.__setitem__(
            "Modeling-Command-Id", command_id
        ),
        clock=get_command_now,
        operator=identity,
    )
