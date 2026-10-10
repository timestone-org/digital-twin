"""订阅终态补全正文、摘要与密文，已有增量不重复且冲突明确失败。"""

from typing import Literal

import pytest
from unit.test_codex_streaming import (
    _event,
    _non_tool_events,
    _respond,
    _response,
)

from llmcore import ModelUnavailable
from llmcore.deltas import reasoning_of, text_of
from llmcore.guard import usage_of


@pytest.mark.parametrize("is_streaming", [True, False])
@pytest.mark.parametrize("output_version", [None, "v0"])
async def test_terminal_only_content_preserves_text_reasoning_and_usage(
    is_streaming: bool,
    output_version: Literal["v0", "responses/v1"] | None,
) -> None:
    _, outputs = _non_tool_events()
    terminal = _event(
        "response.completed", response=_response(outputs, "completed")
    )

    reply = await _respond(
        [terminal], is_streaming=is_streaming, output_version=output_version
    )

    assert text_of(reply) == "读取完成。"
    assert usage_of(reply) == {"prompt": 20, "cached": 10, "output": 8}
    if output_version == "v0":
        reasoning = reply.additional_kwargs["reasoning"]
        assert reasoning["summary"][0]["text"] == "先核验身份。"
        assert reasoning["encrypted_content"] == "sealed-reasoning"
    else:
        assert reasoning_of(reply) == "先核验身份。"
        assert any(
            isinstance(block, dict)
            and block.get("encrypted_content") == "sealed-reasoning"
            for block in reply.content
        )


@pytest.mark.parametrize("is_streaming", [True, False])
async def test_terminal_content_appends_only_the_unstreamed_suffix(
    is_streaming: bool,
) -> None:
    events, outputs = _non_tool_events()
    for event in events:
        if event["type"] == "response.output_text.delta":
            event["delta"] = "读取"
        elif event["type"] == "response.reasoning_summary_text.delta":
            event["delta"] = "先核"
    events.append(
        _event("response.completed", response=_response(outputs, "completed"))
    )

    reply = await _respond(events, is_streaming=is_streaming)

    assert text_of(reply) == "读取完成。"
    assert reasoning_of(reply) == "先核验身份。"


@pytest.mark.parametrize("is_streaming", [True, False])
async def test_repeated_terminal_content_does_not_duplicate_deltas(
    is_streaming: bool,
) -> None:
    events, outputs = _non_tool_events()
    terminal = _event(
        "response.completed", response=_response(outputs, "completed")
    )

    reply = await _respond(
        [*events, terminal, terminal], is_streaming=is_streaming
    )

    assert text_of(reply) == "读取完成。"
    assert reasoning_of(reply) == "先核验身份。"
    assert usage_of(reply) == {"prompt": 20, "cached": 10, "output": 8}


@pytest.mark.parametrize("is_streaming", [True, False])
async def test_terminal_content_cannot_contradict_already_streamed_text(
    is_streaming: bool,
) -> None:
    events, outputs = _non_tool_events()
    for event in events:
        if event["type"] == "response.output_text.delta":
            event["delta"] = "另一段内容"
    events.append(
        _event("response.completed", response=_response(outputs, "completed"))
    )

    with pytest.raises(ModelUnavailable, match="终态内容"):
        await _respond(events, is_streaming=is_streaming)


async def test_terminal_diagnostics_exclude_text_and_encrypted_content(
    caplog: pytest.LogCaptureFixture,
) -> None:
    _, outputs = _non_tool_events()
    terminal = _event(
        "response.completed", response=_response(outputs, "completed")
    )

    with caplog.at_level("INFO"):
        await _respond([terminal])

    records = [
        record.payload
        for record in caplog.records
        if getattr(record, "payload", {}).get("event")
        == "codex_response_terminal"
    ]
    assert len(records) == 1
    assert records[0]["text_chars"] == 5
    assert records[0]["reasoning_chars"] == 6
    assert records[0]["streamed_text_chars"] == 0
    assert "读取完成" not in str(records)
    assert "sealed-reasoning" not in str(records)


@pytest.mark.parametrize("is_streaming", [True, False])
async def test_reasoning_summary_in_added_item_is_not_repeated_at_completion(
    is_streaming: bool,
) -> None:
    events, outputs = _non_tool_events()
    added = {
        **events[0],
        "item": {**outputs[0], "encrypted_content": None},
    }
    terminal = _event(
        "response.completed", response=_response(outputs, "completed")
    )

    reply = await _respond([added, terminal], is_streaming=is_streaming)

    assert reasoning_of(reply) == "先核验身份。"
    assert text_of(reply) == "读取完成。"
