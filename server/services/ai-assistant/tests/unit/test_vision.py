"""截图在一个回合里怎么走。

守三条，每一条断了都不报错、只是效果消失：图必须另起一条**用户**消息（塞进
工具消息会被整条丢掉，表现是模型说「我没看到图」而调用明明成功了）、图**不许
落库**（几兆字节的 base64 存一次、每次重放再喂一遍）、带图那一轮才走视觉档
（整个会话都走的话，一次截图之后每句闲聊都按视觉计费）。
"""

from typing import Any

import pytest
from langchain_core.messages import HumanMessage, ToolMessage
from pydantic import ValidationError

from ai_assistant.apps.chat.models import ChatMessage
from ai_assistant.apps.chat.schemas.advance import ToolResultIn
from ai_assistant.apps.chat.services import history, vision
from ai_assistant.apps.chat.services.advance_service import (
    AdvanceInput,
    ClientToolResult,
    has_image,
    incoming_messages,
)
from ai_assistant.settings import MAX_IMAGE_CHARS

PNG = "data:image/png;base64,iVBORw0KGgo="


def _shot(output: Any) -> AdvanceInput:
    return AdvanceInput(
        surface_kind="dashboard-editor",
        tool_results=[ClientToolResult(call_id="c1", output=output)],
    )


def test_a_data_uri_is_recognised_as_a_picture() -> None:
    assert vision.is_image(PNG) is True
    assert vision.is_image("画布上有三个节点") is False


def test_the_tool_message_only_says_where_the_picture_is() -> None:
    # OpenAI 兼容口径只认用户消息里的图片块；工具消息里的图多半被整条丢掉
    messages = incoming_messages(_shot(PNG))
    tool = messages[0]
    assert isinstance(tool, ToolMessage)
    assert tool.content == vision.HANDOFF


def test_the_picture_rides_in_a_user_message_after_the_tool_replies() -> None:
    messages = incoming_messages(_shot(PNG))
    assert len(messages) == 2
    carrier = messages[1]
    assert isinstance(carrier, HumanMessage)
    blocks = carrier.content
    assert isinstance(blocks, list)
    assert blocks[1] == {"type": "image_url", "image_url": {"url": PNG}}


def test_a_plain_result_brings_no_extra_message() -> None:
    messages = incoming_messages(_shot({"node_count": 3}))
    assert len(messages) == 1


def test_the_picture_never_reaches_the_database() -> None:
    role, body = history.to_content(vision.image_message(PNG))
    assert role == "user"
    # 存的是占位而不是那几兆字节：不然每次重放都把它再喂给模型一遍
    assert PNG not in body["text"]
    assert vision.PLACEHOLDER in body["text"]


def test_the_replayed_message_says_a_picture_was_here() -> None:
    _role, body = history.to_content(vision.image_message(PNG))
    row = ChatMessage(session_id=None, seq=1, role="user", content_json=body)
    replayed = history.to_message(row)
    assert vision.PLACEHOLDER in str(replayed.content)


def test_an_oversize_result_is_refused_at_the_door() -> None:
    # 一张没缩过的整屏 PNG 能有十几兆，倒下的不只是这一个请求
    with pytest.raises(ValidationError):
        ToolResultIn(call_id="c1", output="x" * (MAX_IMAGE_CHARS + 1))


def test_a_long_structured_result_is_not_mistaken_for_an_oversize_image() -> (
    None
):
    # 只量字符串：对每一袋结构化结果做序列化测长，等于每个请求都白跑一遍编码
    result = ToolResultIn(call_id="c1", output={"rows": ["x"] * 1000})
    assert result.call_id == "c1"


def test_only_the_round_that_carries_a_picture_goes_to_the_vision_model() -> (
    None
):
    # 整个会话都走视觉档的话，一次截图之后每一句闲聊都按视觉计费
    assert has_image(_shot(PNG)) is True
    assert has_image(_shot({"node_count": 3})) is False
