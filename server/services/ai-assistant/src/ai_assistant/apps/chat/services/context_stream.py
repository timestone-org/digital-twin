"""把容量更新与回合增量放进同一条有序事件流。"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator, Callable
from contextlib import suppress
from typing import TYPE_CHECKING

from langchain_core.messages import BaseMessage

from ai_assistant.apps.chat.services.context_model import ContextModel
from ai_assistant.apps.chat.services.model_retry import RetryingModel
from llmcore.output.payloads import ContextPayload
from llmcore.ports import ModelChoice
from llmcore.turn.loop import TurnDeps, TurnEvent, stream_turn

if TYPE_CHECKING:
    from ai_assistant.apps.chat.services.advance_service import AdvanceDeps

ContextEvent = TurnEvent | ContextPayload


def context_model(
    deps: AdvanceDeps,
    choice: ModelChoice,
    report: Callable[[ContextPayload], None],
    pinned_text: str | None,
) -> ContextModel:
    """装配本次推进的容量守卫；Args: deps, choice, report, pinned_text。"""
    return ContextModel(
        model=RetryingModel(deps.model),
        summarizer=deps.summarizer(choice.profile),
        max_tokens=deps.context_tokens,
        report=report,
        pinned_text=pinned_text,
    )


async def stream_context(
    deps: TurnDeps,
    messages: list[BaseMessage],
    queue: asyncio.Queue[ContextEvent | Exception | None],
) -> AsyncGenerator[ContextEvent, None]:
    """消费停止时取消并等待模型任务；Args: deps, messages, queue。"""
    worker = asyncio.create_task(_pump(deps, messages, queue))
    try:
        while True:
            item = await queue.get()
            if item is None:
                break
            if isinstance(item, Exception):
                raise item
            yield item
    finally:
        worker.cancel()
        with suppress(asyncio.CancelledError):
            await worker


async def _pump(
    deps: TurnDeps,
    messages: list[BaseMessage],
    queue: asyncio.Queue[ContextEvent | Exception | None],
) -> None:
    """将回合事件、失败和结束标记加入队列；Args: deps, messages, queue。"""
    try:
        async for item in stream_turn(deps, messages):
            queue.put_nowait(item)
    except Exception as error:
        queue.put_nowait(error)
    finally:
        queue.put_nowait(None)
