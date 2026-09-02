"""用户贴的图在一个回合里怎么走。

与截图同一批不变量，但来路不同：图跟着**用户那句话**进来，不是工具截回来的。
守的是——带图那一轮才走视觉档（整个会话都走的话每句闲聊都按视觉计费）、
图不许落库（几兆字节存一次、每次重放再喂一遍）、没有图时那条消息仍是**纯字符串**
（换成单块列表的话，落库与重放那条路要重走一遍验证）。
"""

import pytest
from pydantic import ValidationError

from ai_assistant.apps.chat.models import ChatMessage
from ai_assistant.apps.chat.schemas.advance import AdvanceIn
from ai_assistant.apps.chat.services.advance_service import (
    AdvanceInput,
    ClientToolResult,
    has_image,
    incoming_messages,
)
from ai_assistant.apps.chat.services.perception import vision
from llmcore.memory import history

PNG = "data:image/png;base64,iVBORw0KGgo="


def _said(text: str, images: list[str] | None = None) -> AdvanceInput:
    return AdvanceInput(
        surface_kind="dashboard-editor",
        user_text=text,
        user_images=images or [],
    )


def test_a_turn_with_a_pasted_picture_goes_to_the_vision_lane() -> None:
    assert has_image(_said("照着这张图摆", [PNG])) is True


def test_a_turn_without_one_stays_on_the_chat_lane() -> None:
    """⚠ 不是「这个会话有过图」而是「这一轮有图」：视觉档单价高得多。"""
    assert has_image(_said("再加一个卡片")) is False


def test_a_plain_sentence_is_still_a_bare_string() -> None:
    """没有图时形状一个字不变——落库与重放只对这一形状验过。"""
    messages = incoming_messages(_said("加一个数值卡"))
    assert messages[0].content == "加一个数值卡"


def test_the_sentence_and_its_pictures_ride_one_message() -> None:
    """图与那句话必须同一条消息：拆开的话模型读不出「照着这张」指的是哪张。"""
    messages = incoming_messages(_said("照着这张图摆", [PNG]))
    assert len(messages) == 1
    blocks = messages[0].content
    assert isinstance(blocks, list)
    assert blocks[0] == {"type": "text", "text": "照着这张图摆"}
    assert blocks[1] == {"type": "image_url", "image_url": {"url": PNG}}


def test_a_pasted_picture_never_reaches_the_database() -> None:
    role, body = history.to_content(vision.user_message("看这个", [PNG]))
    assert role == "user"
    assert PNG not in body["text"]
    assert vision.PLACEHOLDER in body["text"]


def test_the_replayed_sentence_keeps_the_words_and_drops_the_bytes() -> None:
    """下一轮模型只看得见占位——所以它当轮就得把结论写成文字。"""
    _role, body = history.to_content(vision.user_message("看这个", [PNG]))
    row = ChatMessage(session_id=None, seq=1, role="user", content_json=body)
    replayed = history.to_message(row)
    assert "看这个" in str(replayed.content)
    assert PNG not in str(replayed.content)


def test_the_placeholder_does_not_call_a_pasted_photo_a_screenshot() -> None:
    """写成「截图」会让模型以为那张现场照片是它自己截的。"""
    assert vision.PLACEHOLDER == "[图片]"


def test_pictures_may_not_ride_along_with_tool_results() -> None:
    """⚠ 那一批工具消息与它们的调用必须相邻，中间插一条带图的会把它们拆开。"""
    with pytest.raises(ValidationError, match="user_images"):
        AdvanceIn(
            surface_kind="dashboard-editor",
            tool_results=[{"call_id": "c1", "output": 1}],  # type: ignore[list-item]  # 理由：入参就是线形字典
            user_images=[PNG],
        )


def test_too_many_pictures_are_refused_at_the_door() -> None:
    """每张都是一份完整的视觉档载荷，贴一叠会把上下文与账单一起顶穿。"""
    with pytest.raises(ValidationError):
        AdvanceIn(
            surface_kind="dashboard-editor",
            user_text="看这些",
            user_images=[PNG] * 5,
        )


def test_a_tool_screenshot_and_a_pasted_one_share_the_same_lane() -> None:
    """两条来路都进视觉档，判定只有一处。"""
    shot = AdvanceInput(
        surface_kind="dashboard-editor",
        tool_results=[ClientToolResult(call_id="c1", output=PNG)],
    )
    assert has_image(shot) is True
