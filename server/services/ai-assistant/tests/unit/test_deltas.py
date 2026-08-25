"""模型逐字吐出来的两路增量怎么读。

**守的是两件在真模型上才会碰到的事**：多模态消息的 content 是一串块而不是
一个字符串（整块 `str()` 出来是一段 Python 字面量，会原样出现在用户的对话框
里），以及思考那一路端点不吐时必须安静地什么都不给。
"""

from typing import Any

from langchain_core.messages import AIMessageChunk

from ai_assistant.llm.deltas import (
    REASONING_KEY,
    DeltaChannel,
    emit,
    reasoning_of,
    text_of,
)


def _sink() -> tuple[list[tuple[DeltaChannel, str]], Any]:
    seen: list[tuple[DeltaChannel, str]] = []

    def push(channel: DeltaChannel, text: str) -> None:
        seen.append((channel, text))

    return seen, push


def test_a_plain_string_chunk_is_read_as_is() -> None:
    assert text_of(AIMessageChunk(content="好的")) == "好的"


def test_a_block_list_keeps_only_the_text_blocks() -> None:
    """多模态消息的 content 是一串块。

    ⚠ 整块 `str()` 出来的是一段 Python 字面量，它会原样出现在用户的对话框里。
    """
    chunk = AIMessageChunk(
        content=[
            {"type": "text", "text": "看图："},
            {"type": "image_url", "image_url": {"url": "data:image/png;,"}},
            {"type": "text", "text": "这里偏高"},
        ]
    )

    assert text_of(chunk) == "看图：这里偏高"


def test_a_bare_string_inside_the_block_list_still_counts() -> None:
    assert text_of(AIMessageChunk(content=["半句", "话"])) == "半句话"


def test_thinking_is_empty_when_the_endpoint_does_not_send_it() -> None:
    assert reasoning_of(AIMessageChunk(content="好的")) == ""


def test_thinking_comes_before_the_answer() -> None:
    """同一块里两路都有时，先想后说才是它们发生的顺序。"""
    seen, push = _sink()
    emit(
        AIMessageChunk(
            content="好的", additional_kwargs={REASONING_KEY: "先查点位"}
        ),
        push,
    )

    assert seen == [("reasoning", "先查点位"), ("text", "好的")]


def test_an_empty_block_hands_nothing_over() -> None:
    """空的一路不吐。

    ⚠ 吐一条空的出去，界面上就是一个空气泡。
    """
    seen, push = _sink()
    emit(AIMessageChunk(content=""), push)

    assert seen == []
