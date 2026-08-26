"""模型逐字吐出来的两路增量怎么读。

**守的是三件在真模型上才会碰到的事**：多模态消息的 content 是一串块而不是
一个字符串（整块 `str()` 出来是一段 Python 字面量，会原样出现在用户的对话框
里）；思考那一路有**两种方言**，只认一种的话另一路的端点想几十秒而界面上一个
字都没有，看着就是卡住了；以及端点不吐思考时必须安静地什么都不给。
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


def _reasoning_block(text: str) -> dict[str, Any]:
    """Responses 方言里的一块思考摘要。

    Args: text。
    """
    return {
        "type": "reasoning",
        "index": 0,
        "summary": [{"index": 0, "type": "summary_text", "text": text}],
    }


def test_the_responses_dialect_puts_the_thinking_in_a_content_block() -> None:
    """订阅账号那一路的思考摘要走内容块，不走 `reasoning_content`。

    ⚠ 只认那一格的话，这一路的端点想几十秒而界面上一个字都没有——用户看到的
    是「点了没反应」，而日志里一切正常。
    """
    chunk = AIMessageChunk(content=[_reasoning_block("**在想过河顺序**")])

    assert reasoning_of(chunk) == "**在想过河顺序**"
    # 思考不许漏进正文：漏了就是一大段自言自语顶在结论前面
    assert text_of(chunk) == ""


def test_a_reasoning_block_without_a_summary_hands_nothing_over() -> None:
    # 摘要开头与结尾各有一块空的（一块带 id、一块带密文），它们不该吐空事件
    seen, push = _sink()
    emit(AIMessageChunk(content=[{"type": "reasoning", "summary": []}]), push)

    assert seen == []
