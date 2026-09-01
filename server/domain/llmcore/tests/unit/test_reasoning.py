"""思考过程那一层薄壳。

**守的是一条会静默消失的能力**：`langchain-openai` 明说自己丢弃第三方端点加的
`reasoning_content`，我们靠覆写它的一个私有接缝把那一格捡回来。库升级改了那个
接缝的表现是「助手不再会思考了」，而两侧代码单看都对——所以这里直接钉签名与
行为，签名一变当场红。
"""

from typing import Any

from langchain_core.messages import AIMessageChunk

from llmcore.deltas import REASONING_KEY, reasoning_of
from llmcore.reasoning import ReasoningChatOpenAI


def _model() -> ReasoningChatOpenAI:
    return ReasoningChatOpenAI(api_key="k", model="m")


def _chunk(delta: dict[str, Any]) -> dict[str, Any]:
    return {"choices": [{"index": 0, "delta": delta, "finish_reason": None}]}


def test_the_thinking_survives_the_conversion() -> None:
    generated = _model()._convert_chunk_to_generation_chunk(
        _chunk({"role": "assistant", REASONING_KEY: "先查点位"}),
        AIMessageChunk,
        None,
    )

    assert generated is not None
    assert reasoning_of(generated.message) == "先查点位"


def test_a_plain_text_chunk_carries_no_thinking() -> None:
    generated = _model()._convert_chunk_to_generation_chunk(
        _chunk({"role": "assistant", "content": "好的"}),
        AIMessageChunk,
        None,
    )

    assert generated is not None
    assert reasoning_of(generated.message) == ""
    assert generated.message.content == "好的"


def test_a_chunk_without_choices_does_not_blow_up_the_stream() -> None:
    """流的第一块与最后一块可能只带用量。

    ⚠ 链式下标会在这里抛 KeyError，而那会把整条流掐断在中途——
    表现是「模型说到一半就没了」。
    """
    generated = _model()._convert_chunk_to_generation_chunk(
        {"usage": {"total_tokens": 12}},
        AIMessageChunk,
        None,
    )

    assert generated is not None
    assert reasoning_of(generated.message) == ""


def test_a_chunk_the_library_drops_stays_dropped() -> None:
    """库自己判定「这一块没有内容」时，我们也不无中生有造一块出来。"""
    generated = _model()._convert_chunk_to_generation_chunk(
        {"type": "content.delta"},
        AIMessageChunk,
        None,
    )

    assert generated is None


def test_an_empty_choice_list_carries_no_thinking() -> None:
    """只带用量的那一块 `choices` 是空的。

    ⚠ 链式下标会在这里抛，而那会把整条流掐断在中途。
    """
    generated = _model()._convert_chunk_to_generation_chunk(
        {"choices": [], "usage": {"total_tokens": 12}},
        AIMessageChunk,
        None,
    )

    assert generated is not None
    assert reasoning_of(generated.message) == ""


def test_a_non_string_thinking_field_is_ignored() -> None:
    """端点把这一格填成别的类型时当没有，不要 `str()` 出一段字面量。"""
    generated = _model()._convert_chunk_to_generation_chunk(
        _chunk({"role": "assistant", REASONING_KEY: 42}),
        AIMessageChunk,
        None,
    )

    assert generated is not None
    assert reasoning_of(generated.message) == ""
