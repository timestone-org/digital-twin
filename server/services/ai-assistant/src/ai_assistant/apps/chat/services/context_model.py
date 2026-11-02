"""每次模型调用前压缩输入投影并报告容量，完整历史不删改。"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.tools import BaseTool
from openai import OpenAIError

from ai_assistant.apps.chat.services.context_budget import (
    bounded_fold,
    rows_of,
    split_messages,
    text_tokens,
    tokens_of,
)
from llmcore.deltas import DeltaChannel, DeltaSink
from llmcore.errors import ModelRejected, detail_of
from llmcore.memory import Summarizer, Summary, summarize
from llmcore.output.payloads import ContextPayload
from llmcore.ports import ModelChoice
from llmcore.turn.ports import Responder

DELTA_USAGE_STEP_TOKENS = 128


@dataclass
class ContextModel:
    """回合内复用同一份摘要与切点。"""

    model: Responder
    summarizer: Summarizer
    max_tokens: int
    report: Callable[[ContextPayload], None]
    pinned_text: str | None = None
    summary: Summary | None = None
    compression_count: int = 0
    dropped_ids: set[str] = field(default_factory=set[str])
    ratio: float = 1.0

    @property
    def budget(self) -> int:
        """保留输出空间后的输入高水位。"""
        return int((self.max_tokens - min(4096, self.max_tokens // 4)) * 0.85)

    async def respond(
        self,
        *,
        choice: ModelChoice,
        messages: list[BaseMessage],
        tools: Sequence[dict[str, Any] | BaseTool],
        on_delta: DeltaSink | None = None,
    ) -> AIMessage:
        """压缩后调用当前步骤；Args: choice, messages, tools, on_delta。"""
        projected = self._project(messages)
        projected = await self._prepare(projected, tools, should_force=False)
        self._emit(tokens_of(projected, tools), "ready")
        progress = _Progress(
            on_delta,
            lambda generated: self._emit(
                tokens_of(projected, tools) + generated, "ready"
            ),
        )
        try:
            reply = await self.model.respond(
                choice=choice,
                messages=projected,
                tools=tools,
                on_delta=progress.emit if on_delta is not None else None,
            )
        except ModelRejected as error:
            if progress.has_output or not _overflow(error):
                raise
            smaller = await self._prepare(projected, tools, should_force=True)
            if tokens_of(smaller, tools) >= tokens_of(projected, tools):
                raise
            projected = smaller
            reply = await self.model.respond(
                choice=choice,
                messages=projected,
                tools=tools,
                on_delta=progress.emit if on_delta is not None else None,
            )
        self._answered(reply, tokens_of(projected, tools))
        return reply

    def _project(self, messages: Sequence[BaseMessage]) -> list[BaseMessage]:
        """复用切点并替换内部摘要；Args: messages。"""
        kept = [
            message
            for message in messages
            if _key(message) not in self.dropped_ids
        ]
        if self.summary is None:
            return kept
        return _with_summary(kept, self.summary)

    async def _prepare(
        self,
        messages: list[BaseMessage],
        tools: Sequence[dict[str, Any] | BaseTool],
        *,
        should_force: bool,
    ) -> list[BaseMessage]:
        """压缩完整批次；Args: messages, tools, should_force。"""
        used = tokens_of(messages, tools)
        if not should_force and used * self.ratio <= self.budget:
            return messages
        self._emit(used, "compressing")
        target = min(int(self.budget / self.ratio), int(used * 0.6))
        dropped, kept = split_messages(
            messages,
            max(0, target - tokens_of([], tools) - 800),
            self.pinned_text,
        )
        if not dropped:
            self._emit(used, "ready")
            return messages
        rows = rows_of(dropped, self.summary.through_seq if self.summary else 0)
        fold_rows, previous = bounded_fold(rows, self.summary, self.max_tokens)
        folded = await self.summarizer.fold(
            fold_rows, rows[-1].seq + 1, previous
        )
        if folded is None:
            self._emit(used, "ready")
            return messages
        projected = _with_summary(kept, folded)
        if tokens_of(projected, tools) >= used:
            self._emit(used, "ready")
            return messages
        self.summary = folded
        self.dropped_ids.update(_key(message) for message in dropped)
        self.compression_count += 1
        self._emit(tokens_of(projected, tools), "compressed")
        return projected

    def _answered(self, reply: AIMessage, estimated: int) -> None:
        """报告完整回包用量并校准估算；Args: reply, estimated。"""
        usage = reply.usage_metadata
        if usage is None:
            self._emit(estimated + tokens_of([reply]), "ready")
            return
        actual = usage["input_tokens"]
        if estimated:
            self.ratio = max(self.ratio, actual / estimated)
        self._emit(actual + usage["output_tokens"], "ready", is_estimated=False)

    def _emit(
        self,
        used: int,
        state: Literal["ready", "compressing", "compressed"],
        *,
        is_estimated: bool = True,
    ) -> None:
        """推送当前容量与压缩状态；Args: used, state, is_estimated。"""
        used = round(used * self.ratio) if is_estimated else used
        self.report(
            ContextPayload(
                used_tokens=used,
                max_tokens=self.max_tokens,
                percent=min(100, round(used / self.max_tokens * 100, 1)),
                is_estimated=is_estimated,
                state=state,
                compression_count=self.compression_count,
            )
        )


@dataclass
class _Progress:
    sink: DeltaSink | None
    report: Callable[[int], None]
    has_output: bool = False
    generated: int = 0
    reported: int = 0

    def emit(self, channel: DeltaChannel, text: str) -> None:
        """转发增量并按输出步长报告用量；Args: channel, text。"""
        self.has_output = self.has_output or bool(text)
        self.generated += text_tokens(text)
        if self.generated - self.reported >= DELTA_USAGE_STEP_TOKENS:
            self.report(self.generated)
            self.reported = self.generated
        if self.sink is not None:
            self.sink(channel, text)


def _with_summary(
    messages: list[BaseMessage], summary: Summary
) -> list[BaseMessage]:
    """仅替换内部标记的摘要，保留用户原文；Args: messages, summary。"""
    kept = [
        message
        for message in messages
        if not summarize.is_summary_message(message)
    ]
    at = 1 if kept and kept[0].type == "system" else 0
    return [*kept[:at], *summarize.messages_of(summary), *kept[at:]]


def _key(message: BaseMessage) -> str:
    """使用持久身份或本次投影的对象身份；Args: message。"""
    return message.id or str(id(message))


def _overflow(error: ModelRejected) -> bool:
    """仅识别上游结构化容量拒绝；Args: error。"""
    cause = error.__cause__
    if not isinstance(cause, OpenAIError):
        return False
    details = detail_of(cause)
    codes = {"context_length_exceeded", "exceed_context_size_error"}
    return details.get("type") in codes or details.get("code") in codes
