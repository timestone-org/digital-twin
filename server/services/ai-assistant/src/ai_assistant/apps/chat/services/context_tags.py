"""模型输入投影专用标记及供应商边界的清理。"""

from __future__ import annotations

from typing import TYPE_CHECKING, Final

if TYPE_CHECKING:
    from collections.abc import Sequence

    from langchain_core.messages import BaseMessage

STATE_SLOT: Final[str] = "assistant_state_snapshot"
IMAGE_CALL_ID: Final[str] = "assistant_image_call_id"


def model_messages(messages: Sequence[BaseMessage]) -> list[BaseMessage]:
    """在发送之前去除本服务的投影标记。Args: messages。"""
    return [
        (
            message.model_copy(
                update={
                    "additional_kwargs": {
                        key: value
                        for key, value in message.additional_kwargs.items()
                        if key not in (STATE_SLOT, IMAGE_CALL_ID)
                    }
                }
            )
            if STATE_SLOT in message.additional_kwargs
            or IMAGE_CALL_ID in message.additional_kwargs
            else message
        )
        for message in messages
    ]
