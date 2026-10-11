"""模型输入的预算投影；完整会话仍由回合图和存储层持有。"""

from collections.abc import Sequence
from dataclasses import dataclass

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    ToolMessage,
)

from knowledge_server.apps.chat.errors import ChatContextTooLarge
from llmcore.memory.history import sized
from llmcore.skills import SkillManifest
from llmcore.skills.context import restored_from_messages

CONTEXT_SLOT = "knowledge_context_slot"
TOOL_RESERVE_CHARS = 464


def marked(messages: Sequence[BaseMessage], slot: str) -> list[BaseMessage]:
    """标记宿主注入块，不靠正文识别系统状态。Args: messages, slot。"""
    return [
        one.model_copy(
            update={
                "additional_kwargs": {
                    **one.additional_kwargs,
                    CONTEXT_SLOT: slot,
                }
            }
        )
        for one in messages
    ]


@dataclass(frozen=True)
class ContextProjection:
    context_chars: int
    schemas_chars: int
    skills: tuple[SkillManifest, ...]
    past: Sequence[BaseMessage]
    restore_chars: int = 4000

    def __call__(self, messages: Sequence[BaseMessage]) -> list[BaseMessage]:
        prefix = _slot(messages, "prefix")
        summary = _slot(messages, "summary")
        dialogue = [
            one for one in messages if CONTEXT_SLOT not in one.additional_kwargs
        ]
        groups = _groups(dialogue)
        if self.context_chars <= 0:
            return [
                *prefix,
                *summary,
                *(one for group in groups for one in group),
                *_slot(messages, "restored"),
            ]
        question = next(
            (
                one
                for one in reversed(dialogue)
                if isinstance(one, HumanMessage)
            ),
            None,
        )
        target = self.context_chars - self.schemas_chars - TOOL_RESERVE_CHARS
        source = [*self.past, *dialogue]
        while True:
            visible = [one for group in groups for one in group]
            restored = restored_from_messages(
                source, visible, self.skills, self.restore_chars
            )
            result = [*prefix, *summary, *visible, *restored]
            if _size(result) <= target:
                return result
            if summary:
                summary = []
            elif _drop_oldest(groups, question):
                continue
            else:
                return self._minimal(prefix + visible, source, target)

    def _minimal(
        self,
        visible: list[BaseMessage],
        source: list[BaseMessage],
        target: int,
    ) -> list[BaseMessage]:
        available = max(1, target - _size(visible))
        restored = restored_from_messages(
            source, visible, self.skills, min(self.restore_chars, available)
        )
        result = [*visible, *restored]
        if _size(result) + self.schemas_chars > self.context_chars:
            raise ChatContextTooLarge(
                "当前问题或工具回执超过模型上下文预算；请缩小查询范围或增加上下文预算后重试"
            )
        return result


def _slot(messages: Sequence[BaseMessage], name: str) -> list[BaseMessage]:
    return [
        one
        for one in messages
        if one.additional_kwargs.get(CONTEXT_SLOT) == name
    ]


def _groups(messages: Sequence[BaseMessage]) -> list[list[BaseMessage]]:
    groups: list[list[BaseMessage]] = []
    calls: dict[str, list[BaseMessage]] = {}
    for message in messages:
        if isinstance(message, ToolMessage):
            if message.tool_call_id in calls:
                calls[message.tool_call_id].append(message)
            continue
        group = [message]
        groups.append(group)
        if isinstance(message, AIMessage):
            for call in message.tool_calls:
                calls[str(call.get("id") or "")] = group
    return groups


def _drop_oldest(
    groups: list[list[BaseMessage]], question: BaseMessage | None
) -> bool:
    for index, group in enumerate(groups[:-1]):
        if question is None or not any(one is question for one in group):
            groups.pop(index)
            return True
    return False


def _size(messages: Sequence[BaseMessage]) -> int:
    return sum(sized(one) for one in messages)
