"""按输出项核对终态正文与思考，只补尚未流出的内容。"""

from dataclasses import dataclass, field
from typing import Any, cast

from langchain_core.messages import AIMessageChunk
from langchain_openai.chat_models import base
from openai.types.responses import (
    Response,
    ResponseOutputItemAddedEvent,
    ResponseOutputItemDoneEvent,
    ResponseOutputMessage,
    ResponseReasoningItem,
    ResponseReasoningSummaryTextDeltaEvent,
    ResponseStreamEvent,
    ResponseTextDeltaEvent,
    ResponseTextDoneEvent,
)

from llmcore.errors import ModelUnavailable


@dataclass
class _Piece:
    index: int
    text: str = ""


@dataclass
class ContentTracker:
    """一次响应中已流出的正文、摘要及密文位置。"""

    texts: dict[tuple[str, int], _Piece] = field(
        default_factory=dict[tuple[str, int], _Piece]
    )
    summaries: dict[tuple[str, int], _Piece] = field(
        default_factory=dict[tuple[str, int], _Piece]
    )
    reasoning_indices: dict[str, int] = field(default_factory=dict[str, int])
    encrypted_ids: set[str] = field(default_factory=set[str])

    def record(self, event: ResponseStreamEvent, index: int) -> None:
        """登记上游转换器实际产出的内容。Args: event, index。"""
        if isinstance(event, ResponseTextDeltaEvent | ResponseTextDoneEvent):
            key = (event.item_id, event.content_index)
            piece = self.texts.setdefault(key, _Piece(index))
            if isinstance(event, ResponseTextDeltaEvent):
                piece.text += event.delta
        elif isinstance(event, ResponseReasoningSummaryTextDeltaEvent):
            key = (event.item_id, event.summary_index)
            self.summaries.setdefault(key, _Piece(index)).text += event.delta
            self.reasoning_indices[event.item_id] = index
        elif isinstance(
            event, ResponseOutputItemAddedEvent | ResponseOutputItemDoneEvent
        ) and isinstance(event.item, ResponseReasoningItem):
            self._record_reasoning(event, index)

    def _record_reasoning(
        self,
        event: ResponseOutputItemAddedEvent | ResponseOutputItemDoneEvent,
        index: int,
    ) -> None:
        item = event.item
        if not isinstance(item, ResponseReasoningItem):
            return
        self.reasoning_indices[item.id] = index
        if isinstance(event, ResponseOutputItemAddedEvent):
            for position, part in enumerate(item.summary):
                key = (item.id, position)
                self.summaries.setdefault(key, _Piece(index)).text += part.text
        if (
            isinstance(event, ResponseOutputItemDoneEvent)
            and item.encrypted_content
        ):
            self.encrypted_ids.add(item.id)

    def finish(
        self, response: Response, index: int, output_version: str | None
    ) -> tuple[AIMessageChunk, int]:
        """从终态补齐未流出的内容，保留已有位置。

        Args: response, index, output_version。
        """
        content: list[str | dict[str, Any]] = []
        for item in response.output:
            if isinstance(item, ResponseOutputMessage):
                blocks, index = self._message(item, index)
                content.extend(blocks)
            elif isinstance(item, ResponseReasoningItem):
                block, index = self._reasoning(item, index)
                if block is not None:
                    content.append(block)
        message = AIMessageChunk(content=content)
        if output_version == "v0":
            message = cast(
                "AIMessageChunk",
                base._convert_to_v03_ai_message(  # noqa: SLF001  # pyright: ignore[reportPrivateUsage, reportPrivateImportUsage]  # 与上游正文线形一致，HTTP契约用例守护
                    message,
                    has_reasoning=bool(self.reasoning_indices),
                ),
            )
        return message, index

    def _message(
        self, item: ResponseOutputMessage, index: int
    ) -> tuple[list[dict[str, Any]], int]:
        blocks: list[dict[str, Any]] = []
        for position, part in enumerate(item.content):
            if part.type != "output_text":
                continue
            piece = self.texts.get((item.id, position))
            suffix = _suffix(part.text, piece.text if piece else "")
            if not suffix:
                continue
            if piece is None:
                index += 1
            blocks.append(
                {
                    "type": "text",
                    "text": suffix,
                    "id": item.id,
                    "index": piece.index if piece else index,
                }
            )
        return blocks, index

    def _reasoning(
        self, item: ResponseReasoningItem, index: int
    ) -> tuple[dict[str, Any] | None, int]:
        summaries: list[dict[str, object]] = []
        for position, part in enumerate(item.summary):
            piece = self.summaries.get((item.id, position))
            suffix = _suffix(part.text, piece.text if piece else "")
            if suffix:
                summaries.append(
                    {"type": "summary_text", "text": suffix, "index": position}
                )
        encrypted = (
            item.encrypted_content
            if item.id not in self.encrypted_ids
            else None
        )
        if not summaries and not encrypted:
            return None, index
        prior = self.reasoning_indices.get(item.id)
        if prior is None:
            index += 1
        block: dict[str, Any] = {
            "type": "reasoning",
            "id": item.id,
            "summary": summaries,
            "index": prior if prior is not None else index,
        }
        if encrypted:
            block["encrypted_content"] = encrypted
        return block, index


def _suffix(complete: str, streamed: str) -> str:
    """终态必须包含已流出的前缀。Args: complete, streamed。"""
    if not complete.startswith(streamed):
        raise ModelUnavailable("模型终态内容与已流出的内容不一致")
    return complete[len(streamed) :]
