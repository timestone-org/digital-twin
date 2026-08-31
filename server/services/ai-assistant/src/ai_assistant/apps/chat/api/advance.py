"""推进一个回合 —— 本服务唯一的流式端点。

⚠ **它不走统一信封。** 流一旦开始就没法再改状态码，所以这里的 HTTP 状态码
只表达「这次请求受不受理」；回合内的失败走 `error` 事件（api-contract 的
一条显式豁免，理由与边界写在 ADR-0023）。

⚠ 边缘那条 location **必须关掉 `proxy_buffering` 并单独写全超时**：
`proxy-common.conf` 的 25s 读超时会把一次模型调用拦腰切断，而 nginx 不许在
同一个 location 里重复声明同一指令，所以那条不能 include 它。
"""

import uuid
from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from ai_assistant.apps.chat.catalog import ASSISTANT_USE
from ai_assistant.apps.chat.deps import get_advance_deps
from ai_assistant.apps.chat.schemas.advance import AdvanceIn
from ai_assistant.apps.chat.services import advance_service
from ai_assistant.apps.chat.services.output import events
from ai_assistant.apps.chat.services.perception import UnsupportedInput
from ai_assistant.apps.chat.services.perception.decoders.image import (
    check_data_uri,
)
from ai_assistant.apps.chat.services.planning.plan import PlanUpdate
from ai_assistant.apps.chat.services.planning.turn_types import (
    TurnDelta,
    TurnStep,
)
from ai_assistant.apps.chat.services.session_service import require_session
from ai_assistant.deps import get_session, require
from ai_assistant.settings import API_PREFIX
from lib.auth import CallerContext
from lib.errors import AppError, ValidationFailed
from lib.logging import current_log_context, get_logger

router = APIRouter(prefix=f"{API_PREFIX}/sessions", tags=["turn"])

_logger = get_logger("assistant.api.advance")

AdvanceDep = Annotated[advance_service.AdvanceDeps, Depends(get_advance_deps)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]
UseDep = Annotated[CallerContext, Depends(require(ASSISTANT_USE))]

# ⚠ 关掉中间层缓冲。攒着一起吐的话，「一步步可见」退化成「最后一起出现」，
# 而那正是这条端点存在的全部理由
_STREAM_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


@router.post("/{session_id}:advance", summary="推进一个回合（事件流）")
async def advance_turn(
    session_id: uuid.UUID,
    payload: AdvanceIn,
    session: SessionDep,
    deps: AdvanceDep,
    caller: UseDep,
) -> StreamingResponse:
    """跑一个回合，每走完一步就推一帧。

    Args: session_id, payload, session, deps, caller。
    """
    await require_session(session, chat_session_id=session_id, caller=caller)
    _check_images(payload)
    stream = _frames(deps, session_id, payload)
    return StreamingResponse(
        stream, media_type="text/event-stream", headers=_STREAM_HEADERS
    )


def _check_images(payload: AdvanceIn) -> None:
    """贴进来的图必须过白名单，且**在开流之前**判。

    ⚠ 开流之后就改不了状态码了，那时只能回一个 `error` 事件——而「这张图不收」
    是调用方能当场改的事，该拿到一个 422 而不是一条流里的错。

    ⚠ 判的是解出来的字节而不是 URI 里声明的 media type，判定与解码器同一份
    （`perception/decoders/image`）。

    Args: payload。
    """
    for at, uri in enumerate(payload.user_images, start=1):
        try:
            check_data_uri(uri, f"第 {at} 张图")
        except UnsupportedInput as error:
            raise ValidationFailed(str(error)) from error


async def _frames(
    deps: advance_service.AdvanceDeps,
    session_id: uuid.UUID,
    payload: AdvanceIn,
) -> AsyncIterator[str]:
    """逐帧吐。回合内的失败落成 `error` 事件而不是断流。

    Args: deps, session_id, payload。
    """
    # 与统一信封里的那一个同源：用户报「刚才出错了」时，它是唯一能把
    # 界面上那一条与后端日志接起来的东西
    trace_id = current_log_context().trace_id or ""
    try:
        async for item in advance_service.advance(
            deps,
            chat_session_id=session_id,
            payload=_to_input(payload),
        ):
            yield _frame_of(item)
    except AppError as error:
        _logger.warning("turn_failed", "回合失败", code=error.code)
        yield events.error_frame(error.code, str(error), trace_id)


def _frame_of(item: advance_service.AdvanceEvent) -> str:
    """一件产出摊成一帧。

    ⚠ 分档必须穷尽。漏一档的表现是「助手做了一步但界面上没有」，而两侧代码
    单看都对（events.py 的文件头写了同一条）。

    Args: item。
    """
    if isinstance(item, TurnDelta):
        return events.delta_frame(item)
    if isinstance(item, TurnStep):
        return events.step_frame(item)
    if isinstance(item, PlanUpdate):
        return events.plan_frame(item.plan)
    return events.outcome_frame(item)


def _to_input(payload: AdvanceIn) -> advance_service.AdvanceInput:
    return advance_service.AdvanceInput(
        surface_kind=payload.surface_kind,
        surface_label=payload.surface_label,
        surface_context=payload.surface_context,
        client_tools=payload.client_tools,
        user_text=payload.user_text,
        user_images=list(payload.user_images),
        tool_results=[
            advance_service.ClientToolResult(
                call_id=result.call_id,
                output=result.output,
                error=result.error,
            )
            for result in payload.tool_results
        ],
    )
