"""仅当前账号可查询的持久建模写命令。"""

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.logging import get_logger
from lib.web import ApiResponse, ok
from lib.web.response import error_payload
from platform_server.apps.modeling.catalog import MODELING_VIEW
from platform_server.apps.modeling.command_deps import get_command_now
from platform_server.apps.modeling.command_errors import CommandPending
from platform_server.apps.modeling.schemas.command import (
    CommandOperation,
    ModelingCommandOut,
)
from platform_server.apps.modeling.services import command_service
from platform_server.apps.modeling.services.command_policy import (
    choose_operation,
)
from platform_server.deps import get_session, require
from platform_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/modeling-commands", tags=["modeling-command"]
)
SessionDep = Annotated[AsyncSession, Depends(get_session)]
ViewDep = Annotated[CallerContext, Depends(require(MODELING_VIEW))]
NowDep = Annotated[datetime, Depends(get_command_now)]
KeyDep = Annotated[str, Header(alias="Idempotency-Key")]
_logger = get_logger("platform.modeling.commands")


async def handle_command_pending(
    _request: Request, error: Exception
) -> JSONResponse:
    if not isinstance(error, CommandPending):
        raise error
    _logger.warning("modeling_command_pending", error.message, code=error.code)
    return JSONResponse(
        status_code=error.http_status,
        content=error_payload(code=error.code, message=error.message),
        headers={
            "Retry-After": "1",
            "Modeling-Command-Id": error.command_id,
        },
    )


@router.get("", response_model=ApiResponse[ModelingCommandOut])
async def find_command(
    operation: CommandOperation,
    key: KeyDep,
    session: SessionDep,
    caller: ViewDep,
    resource_id: uuid.UUID | None = None,
) -> ApiResponse[ModelingCommandOut]:
    return ok(
        await command_service.find_command(
            session,
            caller,
            choose_operation(operation, resource_id),
            key,
            get_command_now(),
        )
    )


@router.get("/{command_id}", response_model=ApiResponse[ModelingCommandOut])
async def get_command(
    command_id: uuid.UUID,
    session: SessionDep,
    caller: ViewDep,
    now: NowDep,
) -> ApiResponse[ModelingCommandOut]:
    return ok(
        await command_service.get_command(session, caller, command_id, now)
    )
