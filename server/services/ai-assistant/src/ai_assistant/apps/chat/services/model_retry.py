"""助手当前模型步骤的有界重试；策略见 docs/AI_ASSISTANT_DESIGN.md。"""

from asyncio import sleep
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.tools import BaseTool

from lib.logging import get_logger
from llmcore.deltas import DeltaChannel, DeltaSink
from llmcore.errors import ModelUnavailable
from llmcore.ports import ModelChoice
from llmcore.turn.ports import Responder

MAX_FAILURES = 5
RETRY_DELAY_S = 10.0
_logger = get_logger("assistant.model_retry")


@dataclass(frozen=True)
class RetryingModel:
    """只重试当前模型请求，保留回合中已经完成的工具结果。"""

    model: Responder
    wait: Callable[[float], Awaitable[None]] = sleep

    async def respond(
        self,
        *,
        choice: ModelChoice,
        messages: list[BaseMessage],
        tools: Sequence[dict[str, Any] | BaseTool],
        on_delta: DeltaSink | None = None,
    ) -> AIMessage:
        """有界重试；Args: choice, messages, tools, on_delta。"""
        progress = _Progress(on_delta)
        attempt = 0
        while True:
            attempt += 1
            try:
                return await self.model.respond(
                    choice=choice,
                    messages=messages,
                    tools=tools,
                    on_delta=progress.emit if on_delta is not None else None,
                )
            except ModelUnavailable as error:
                if attempt == MAX_FAILURES:
                    raise ModelUnavailable(
                        f"{error}（连续 {MAX_FAILURES} 次失败，已停止）"
                    ) from error
                _logger.warning(
                    "assistant_model_retry_scheduled",
                    "模型暂不可用，等待后重试当前步骤",
                    attempt=attempt,
                    max_failures=MAX_FAILURES,
                    delay_s=RETRY_DELAY_S,
                    kind=choice.kind,
                )
                progress.retry(attempt)
                await self.wait(RETRY_DELAY_S)


@dataclass
class _Progress:
    sink: DeltaSink | None
    has_text: bool = False

    def emit(self, channel: DeltaChannel, text: str) -> None:
        if channel == "text" and text:
            self.has_text = True
        if self.sink is not None:
            self.sink(channel, text)

    def retry(self, attempt: int) -> None:
        if self.sink is None:
            return
        notice = f"模型暂未响应（第 {attempt}/5 次失败），10 秒后重试。"
        self.sink("reasoning", f"\n\n{notice}\n\n")
        if self.has_text:
            self.sink("text", "\n\n（上段响应中断，正在重新生成。）\n\n")
            self.has_text = False
