"""在正文模型失败时记下已受理的提问。"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage
from langchain_core.tools import BaseTool

from knowledge_server.apps.chat.services.advance_persist import (
    Sessions,
    retain_failed_question,
)
from lib.logging import get_logger
from llmcore import ModelChoice
from llmcore.deltas import DeltaSink
from llmcore.turn import Responder

_logger = get_logger("knowledge.chat.failed_question")


@dataclass(frozen=True)
class RetainingResponder:
    """正文模型失败时保存原问，保留原异常供事件流处理。"""

    model: Responder
    sessions: Sessions
    chat_session_id: uuid.UUID
    question: str

    async def respond(
        self,
        *,
        choice: ModelChoice,
        messages: list[BaseMessage],
        tools: Sequence[dict[str, Any] | BaseTool],
        on_delta: DeltaSink | None = None,
    ) -> AIMessage:
        """调用正文模型。Args: choice, messages, tools, on_delta。"""
        try:
            return await self.model.respond(
                choice=choice, messages=messages, tools=tools, on_delta=on_delta
            )
        except Exception:
            try:
                await retain_failed_question(
                    self.sessions, self.chat_session_id, self.question
                )
            except Exception as error:
                _logger.warning(
                    "kb_chat_failed_question_unrecorded",
                    "失败的提问未保存",
                    reason=type(error).__name__,
                )
            raise
