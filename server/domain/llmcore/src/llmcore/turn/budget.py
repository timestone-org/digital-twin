"""为同一批工具调用分配模型输入的剩余额度。"""

import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, Final

from langchain_core.messages import BaseMessage

from llmcore.errors import ModelRejected
from llmcore.memory.history import sized

MIN_TOOL_RESULT_CHARS: Final[int] = 400
MESSAGE_FRAME_CHARS: Final[int] = 16
RemainingBudget = Callable[
    [Sequence[BaseMessage], Sequence[dict[str, Any]]], int
]


class ToolBatchTooLarge(ModelRejected):
    """完整工具批次无法放入调用方提供的剩余额度。"""


@dataclass(frozen=True)
class ToolBudget:
    """本回合实际工具声明及结果配额。"""

    schemas: list[dict[str, Any]]
    max_context: int
    max_result: int
    remaining: RemainingBudget | None

    def _left(self, messages: Sequence[BaseMessage]) -> int:
        if self.remaining is not None:
            return self.remaining(messages, self.schemas)
        used = len(json.dumps(self.schemas, ensure_ascii=False)) + sum(
            sized(one) for one in messages
        )
        return self.max_context - used

    def can_offer(self, messages: Sequence[BaseMessage]) -> bool:
        # 自定义计量器在模型压缩完成后、工具执行前判整批。
        return (
            self.remaining is not None
            or self.max_context <= 0
            or self._left(messages) > MIN_TOOL_RESULT_CHARS
        )

    def check_batch(self, messages: Sequence[BaseMessage], count: int) -> None:
        if self.remaining is not None and self._left(messages) < count * (
            MIN_TOOL_RESULT_CHARS + MESSAGE_FRAME_CHARS
        ):
            raise ToolBatchTooLarge(
                "本批工具调用超过结果预算，尚未执行；请减少并行调用数量"
            )

    def share(self, messages: Sequence[BaseMessage], count: int) -> int:
        if self.remaining is None and self.max_context <= 0:
            return self.max_result
        left = self._left(messages)
        if self.remaining is not None:
            left = left // count - MESSAGE_FRAME_CHARS
            if left < MIN_TOOL_RESULT_CHARS:
                raise ToolBatchTooLarge(
                    "剩余工具结果预算不足；未继续执行本批的后续调用"
                )
        return max(MIN_TOOL_RESULT_CHARS, min(self.max_result, left))
