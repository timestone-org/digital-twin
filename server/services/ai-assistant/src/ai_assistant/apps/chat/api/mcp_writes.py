"""对持久化 MCP 写调用准备摘要、逐次确认或取消。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends

from ai_assistant.apps.chat.catalog import ASSISTANT_USE
from ai_assistant.apps.chat.schemas.mcp_writes import (
    McpWriteDecisionIn,
    McpWritePrepareIn,
    McpWritePrepareOut,
    McpWriteResultOut,
)
from ai_assistant.apps.chat.services.mcp_writes import (
    McpWriteDeps,
    McpWriteService,
)
from ai_assistant.container import Container
from ai_assistant.deps import get_container, require
from ai_assistant.settings import API_PREFIX
from lib.auth import CallerContext
from lib.web import ApiResponse, ok


def get_mcp_write_service(
    container: Annotated[Container, Depends(get_container)],
) -> McpWriteService:
    """组合根依赖，无进程内确认状态。

    Args: container。"""
    return McpWriteService(
        McpWriteDeps(
            container.database.session,
            container.settings,
            container.auth,
            container.mcp,
            container.platform,
        )
    )


ServiceDep = Annotated[McpWriteService, Depends(get_mcp_write_service)]
UseDep = Annotated[CallerContext, Depends(require(ASSISTANT_USE))]
router = APIRouter(prefix=f"{API_PREFIX}/sessions", tags=["turn"])


@router.post(
    "/{session_id}/mcp-writes/{call_id}:prepare",
    response_model=ApiResponse[McpWritePrepareOut],
    summary="准备 MCP 写确认",
)
async def prepare_mcp_write(
    session_id: uuid.UUID,
    call_id: str,
    service: ServiceDep,
    caller: UseDep,
    payload: McpWritePrepareIn | None = None,
) -> ApiResponse[McpWritePrepareOut]:
    """摘要只从已存调用读取。

    Args: session_id, call_id, service, caller, payload。"""
    del payload
    return ok(await service.prepare(session_id, call_id, caller))


@router.post(
    "/{session_id}/mcp-writes/{call_id}:decide",
    response_model=ApiResponse[McpWriteResultOut],
    summary="确认或取消 MCP 写操作",
)
async def decide_mcp_write(
    session_id: uuid.UUID,
    call_id: str,
    payload: McpWriteDecisionIn,
    service: ServiceDep,
    caller: UseDep,
) -> ApiResponse[McpWriteResultOut]:
    """服务端派发并记录实际回执。

    Args: session_id, call_id, payload, service, caller。"""
    result = await service.decide(session_id, call_id, caller, payload)
    return ok(
        McpWriteResultOut(
            call_id=result.call_id,
            output=result.output,
            error=result.error,
        )
    )
