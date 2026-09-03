"""推进一个回合 —— 对话面唯一的流式端点。

⚠ **它不走统一信封。** 流一旦开始就没法再改状态码，所以这里的 HTTP 状态码
只表达「这次请求受不受理」；回合内的失败走 `error` 事件（api-contract 的
一条显式豁免，理由与边界写在 ADR-0023）。

⚠ 边缘那条 location **必须关掉 `proxy_buffering` 并单独写全超时**
（`nginx.conf.template` 里知识库那段照助手那段抄的）。
"""

import uuid
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.chat.deps import get_advance_deps
from knowledge_server.apps.chat.schemas import ChatAdvanceIn
from knowledge_server.apps.chat.services import advance_service
from knowledge_server.apps.chat.services.session_service import (
    require_session,
)
from knowledge_server.apps.chat.services.title_service import SessionTitled
from knowledge_server.catalog import KNOWLEDGE_USE
from knowledge_server.deps import get_session, require
from knowledge_server.settings import API_PREFIX
from lib.auth import CallerContext
from lib.errors import AppError
from lib.logging import current_log_context, get_logger
from llmcore.output import events
from llmcore.turn import TurnDelta, TurnEvent, TurnStep

router = APIRouter(prefix=f"{API_PREFIX}/chat-sessions", tags=["chat"])

_logger = get_logger("knowledge.chat.advance")

AdvanceDep = Annotated[advance_service.AdvanceDeps, Depends(get_advance_deps)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]
UseDep = Annotated[CallerContext, Depends(require(KNOWLEDGE_USE))]

# ⚠ 关掉中间层缓冲。攒着一起吐的话，「一步步可见」退化成「最后一起出现」
_STREAM_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


@router.post("/{session_id}:advance", summary="推进一个回合（事件流）")
async def advance_turn(
    session_id: uuid.UUID,
    payload: ChatAdvanceIn,
    session: SessionDep,
    deps: AdvanceDep,
    caller: UseDep,
) -> StreamingResponse:
    """跑一个回合，每走完一步就推一帧。

    Args: session_id, payload, session, deps, caller。
    """
    await require_session(session, chat_session_id=session_id, caller=caller)
    stream = _frames(deps, session_id, payload)
    return StreamingResponse(
        stream, media_type="text/event-stream", headers=_STREAM_HEADERS
    )


async def _frames(
    deps: advance_service.AdvanceDeps,
    session_id: uuid.UUID,
    payload: ChatAdvanceIn,
) -> AsyncIterator[str]:
    """逐帧吐。回合内的失败落成 `error` 事件而不是断流。

    Args: deps, session_id, payload。
    """
    trace_id = current_log_context().trace_id or ""
    try:
        async for item in advance_service.advance(
            deps, chat_session_id=session_id, payload=_to_input(payload)
        ):
            yield _frame_of(item)
    except AppError as error:
        _logger.warning("kb_turn_failed", "回合失败", code=error.code)
        yield events.error_frame(error.code, str(error), trace_id)


def _frame_of(item: TurnEvent | SessionTitled) -> str:
    """一件产出摊成一帧。分档必须穷尽。

    ⚠ 新增的档要排在兜底那一行**之前**：兜底当的是 `TurnOutcome`，
    漏一档的表现是那一帧被当成 outcome 序列化，而前端读到一个没有 reply 的
    结束帧——回合看着结束了，答案没了。

    Args: item。
    """
    if isinstance(item, TurnDelta):
        return events.delta_frame(item)
    if isinstance(item, TurnStep):
        return events.step_frame(item)
    if isinstance(item, SessionTitled):
        return events.frame(
            "session_titled",
            {"title": item.title, "row_version": item.row_version},
        )
    return events.outcome_frame(item)


def _to_input(payload: ChatAdvanceIn) -> advance_service.AdvanceInput:
    return advance_service.AdvanceInput(
        user_text=payload.user_text,
        tool_results=[
            advance_service.ClientToolResult(
                call_id=result.call_id,
                output=result.output,
                error=result.error,
            )
            for result in payload.tool_results
        ],
        client_tools=tuple(payload.client_tools),
    )
