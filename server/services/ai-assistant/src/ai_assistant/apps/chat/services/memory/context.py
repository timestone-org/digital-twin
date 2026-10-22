"""助手模型输入投影：保护当前请求与工具批次，预算不改变持久化历史。"""

import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, Protocol

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    ToolMessage,
)

from ai_assistant.apps.chat.errors import ChatContextTooLarge
from ai_assistant.apps.chat.services.memory import state_block
from ai_assistant.apps.chat.services.planning import plan as plan_service
from ai_assistant.llm import ModelChoice
from llmcore.memory.history import IMAGE_PLACEHOLDER, sized
from llmcore.skills import SkillManifest
from llmcore.skills.context import restored_from_messages
from llmcore.tools.shapes import ToolSpec, openai_schema

CONTEXT_SLOT = "assistant_context_slot"
IMAGE_CALL_ID = "assistant_image_call_id"
TOOL_RESERVE_CHARS = 512
IMAGE_RESERVE_CHARS = 9830
CHARS_PER_TOKEN = 1.2
OUTPUT_RESERVE_TOKENS = 4096


def context_chars(tokens: int) -> int:
    """按显式窗口与输出预留估算输入预算；Args: tokens。"""
    reserved = min(OUTPUT_RESERVE_TOKENS, max(512, tokens // 4))
    return max(1, int((tokens - reserved) * CHARS_PER_TOKEN))


def schemas_chars(specs: Sequence[ToolSpec]) -> int:
    """计入实际声明及参数定义；Args: specs。"""
    return len(
        json.dumps([openai_schema(one) for one in specs], ensure_ascii=False)
    )


def marked(messages: Sequence[BaseMessage], slot: str) -> list[BaseMessage]:
    """用宿主元数据区分状态与用户内容；Args: messages, slot。"""
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


def slot_of(messages: Sequence[BaseMessage], slot: str) -> list[BaseMessage]:
    """读取宿主标记的消息；Args: messages, slot。"""
    return [
        one
        for one in messages
        if one.additional_kwargs.get(CONTEXT_SLOT) == slot
    ]


def unmarked(message: BaseMessage) -> BaseMessage:
    """移除宿主记账字段，模型与供应商只接收原有消息语义。"""
    return message.model_copy(
        update={
            "additional_kwargs": {
                key: value
                for key, value in message.additional_kwargs.items()
                if key not in {CONTEXT_SLOT, IMAGE_CALL_ID}
            }
        }
    )


def input_size(messages: Sequence[BaseMessage]) -> int:
    """文本估算加每张图片的独立预留；Args: messages。"""
    return sum(sized(one) + 16 for one in messages) + image_size(messages)


def image_size(messages: Sequence[BaseMessage]) -> int:
    """图片输入的估算预留，不读取或统计 base64；Args: messages。"""
    total = 0
    for message in messages:
        if isinstance(message.content, list):
            total += IMAGE_RESERVE_CHARS * sum(
                1
                for block in message.content
                if isinstance(block, dict)
                and block.get("type") in {"image_url", "input_image"}
            )
    return total


@dataclass(frozen=True)
class ContextProjection:
    context_chars: int
    schemas_chars: int
    skills: tuple[SkillManifest, ...]
    past: Sequence[BaseMessage]
    tail: Callable[[], Sequence[BaseMessage]]

    @property
    def text_budget(self) -> int:
        return max(1, self.context_chars - TOOL_RESERVE_CHARS)

    def __call__(self, messages: Sequence[BaseMessage]) -> list[BaseMessage]:
        prefix = slot_of(messages, "prefix")
        summary = slot_of(messages, "summary")
        restored = slot_of(messages, "restored")
        dialogue = [
            one for one in messages if CONTEXT_SLOT not in one.additional_kwargs
        ]
        groups = _groups(dialogue)
        question = next(
            (one for one in reversed(dialogue) if _is_request(one)), None
        )
        source = [*self.past, *dialogue]
        tail = list(self.tail())
        target = self.context_chars - self.schemas_chars - TOOL_RESERVE_CHARS
        preferred = target - min(8192, max(512, self.context_chars // 8))
        while True:
            visible = [one for group in groups for one in group]
            recovery = restored_from_messages(source, visible, self.skills)
            result = [*prefix, *summary, *visible, *restored, *recovery, *tail]
            if input_size(result) <= preferred:
                return [unmarked(one) for one in result]
            if summary:
                summary = []
            elif _drop_oldest(groups, question):
                continue
            else:
                if input_size(result) <= target:
                    return [unmarked(one) for one in result]
                raise ChatContextTooLarge(
                    "当前工具声明、用户要求或回执超过模型上下文预算；"
                    "请缩小本次范围，或按实际模型窗口调整 "
                    "ASSISTANT_MODEL_CONTEXT_TOKENS。"
                    "未重新执行任何业务工具。"
                )


def _is_request(message: BaseMessage) -> bool:
    if not isinstance(message, HumanMessage):
        return False
    if IMAGE_CALL_ID in message.additional_kwargs:
        return False
    if isinstance(message.content, str):
        return bool(message.content.replace(IMAGE_PLACEHOLDER, "").strip())
    return any(
        isinstance(block, dict) and block.get("type") == "text"
        for block in message.content
    )


def _groups(messages: Sequence[BaseMessage]) -> list[list[BaseMessage]]:
    groups: list[list[BaseMessage]] = []
    calls: dict[str, list[BaseMessage]] = {}
    for message in messages:
        if isinstance(message, ToolMessage):
            if message.tool_call_id in calls:
                calls[message.tool_call_id].append(message)
            continue
        image_call = message.additional_kwargs.get(IMAGE_CALL_ID)
        if isinstance(image_call, str) and image_call in calls:
            calls[image_call].append(message)
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
        if not any(
            one is question or IMAGE_CALL_ID in one.additional_kwargs
            for one in group
        ):
            groups.pop(index)
            return True
    return False


class ContextSettings(Protocol):
    @property
    def model_context_tokens(self) -> int: ...

    @property
    def vision_context_tokens(self) -> int: ...


def projection_of(
    deps: ContextSettings,
    opened: tuple[list[BaseMessage], ModelChoice, dict[str, Any] | None],
    specs: tuple[ToolSpec, ...],
    selected: tuple[SkillManifest, ...],
    plans: plan_service.PlanTools,
) -> ContextProjection:
    messages, choice, snapshot = opened
    tokens = deps.model_context_tokens
    if choice.kind == "vision" and deps.vision_context_tokens:
        tokens = deps.vision_context_tokens
    initial = slot_of(messages, "state")

    def tail() -> Sequence[BaseMessage]:
        if plans.latest is None:
            return initial
        return state_block.messages_of(
            snapshot,
            plans.latest,
        )

    return ContextProjection(
        context_chars(tokens),
        schemas_chars(specs),
        selected,
        messages,
        tail,
    )
