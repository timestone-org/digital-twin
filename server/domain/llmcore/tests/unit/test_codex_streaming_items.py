"""已完成输出项在空终态中保留，重复回执幂等且冲突失败关闭。"""

import pytest
from unit.test_codex_streaming import (
    _added,
    _assert_calls,
    _done,
    _event,
    _items,
    _non_tool_events,
    _respond,
    _response,
)

from llmcore import ModelUnavailable
from llmcore.deltas import reasoning_of, text_of


@pytest.mark.parametrize("is_streaming", [True, False])
@pytest.mark.parametrize("count", [1, 12])
async def test_done_tool_items_survive_an_empty_completed_output(
    is_streaming: bool,
    count: int,
) -> None:
    items = _items(count)
    events: list[dict[str, object]] = []
    for index, item in enumerate(items):
        events.append(_added(index, item))
        events.extend(_done(index, item))
    events.append(
        _event("response.completed", response=_response([], "completed"))
    )

    reply = await _respond(events, is_streaming=is_streaming)

    _assert_calls(reply, count)


@pytest.mark.parametrize("is_streaming", [True, False])
async def test_conflicting_done_and_terminal_arguments_cannot_execute_tools(
    is_streaming: bool,
) -> None:
    item = _items(1)[0]
    changed = {**item, "arguments": '{"key":"different"}'}
    events = [
        *_done(0, item),
        _event(
            "response.completed", response=_response([changed], "completed")
        ),
    ]

    with pytest.raises(ModelUnavailable):
        await _respond(events, is_streaming=is_streaming)


@pytest.mark.parametrize("is_streaming", [True, False])
async def test_conflicting_repeated_done_items_cannot_execute_tools(
    is_streaming: bool,
) -> None:
    item = _items(1)[0]
    changed = {**item, "arguments": '{"key":"different"}'}
    events = [
        *_done(0, item),
        *_done(0, changed),
        _event("response.completed", response=_response([], "completed")),
    ]

    with pytest.raises(ModelUnavailable):
        await _respond(events, is_streaming=is_streaming)


@pytest.mark.parametrize("is_streaming", [True, False])
async def test_repeated_reasoning_done_items_do_not_duplicate_encrypted_content(
    is_streaming: bool,
) -> None:
    events, _ = _non_tool_events()
    done = next(
        event
        for event in events
        if event["type"] == "response.output_item.done"
    )
    events.insert(events.index(done) + 1, done)
    events.append(
        _event("response.completed", response=_response([], "completed"))
    )

    reply = await _respond(events, is_streaming=is_streaming)

    assert text_of(reply) == "读取完成。"
    assert reasoning_of(reply) == "先核验身份。"
    assert [
        block["encrypted_content"]
        for block in reply.content
        if isinstance(block, dict) and "encrypted_content" in block
    ] == ["sealed-reasoning"]


@pytest.mark.parametrize("is_streaming", [True, False])
async def test_done_items_still_require_a_completed_response_to_execute(
    is_streaming: bool,
) -> None:
    item = _items(1)[0]
    events = [
        *_done(0, item),
        _event("response.incomplete", response=_response([], "incomplete")),
    ]

    with pytest.raises(ModelUnavailable):
        await _respond(events, is_streaming=is_streaming)


@pytest.mark.parametrize("is_streaming", [True, False])
async def test_partial_terminal_output_preserves_sparse_done_item_order(
    is_streaming: bool,
) -> None:
    items = _items(2)
    events = [
        *_done(2, items[0]),
        *_done(3, items[1]),
        _event(
            "response.completed", response=_response(items[1:], "completed")
        ),
    ]

    reply = await _respond(events, is_streaming=is_streaming)

    _assert_calls(reply, 2)


@pytest.mark.parametrize("is_streaming", [True, False])
async def test_distinct_done_items_cannot_share_a_function_call_id(
    is_streaming: bool,
) -> None:
    items = _items(2)
    items[1] = {**items[1], "call_id": "call-0"}
    events = [
        *_done(0, items[0]),
        *_done(1, items[1]),
        _event("response.completed", response=_response([], "completed")),
    ]

    with pytest.raises(ModelUnavailable):
        await _respond(events, is_streaming=is_streaming)


@pytest.mark.parametrize("is_streaming", [True, False])
async def test_added_item_positions_preserve_partial_terminal_output_order(
    is_streaming: bool,
) -> None:
    items = _items(4)
    events = [
        *[_added(index, items[index]) for index in (0, 2, 3)],
        *_done(2, items[2]),
        _event(
            "response.completed",
            response=_response([items[0], items[3]], "completed"),
        ),
    ]

    reply = await _respond(events, is_streaming=is_streaming)

    assert [call["id"] for call in reply.tool_calls] == [
        "call-0",
        "call-2",
        "call-3",
    ]


@pytest.mark.parametrize("is_streaming", [True, False])
async def test_added_and_done_items_cannot_change_identity_at_one_position(
    is_streaming: bool,
) -> None:
    items = _items(2)
    events = [
        _added(0, items[0]),
        *_done(0, items[1]),
        _event("response.completed", response=_response([], "completed")),
    ]

    with pytest.raises(ModelUnavailable):
        await _respond(events, is_streaming=is_streaming)


@pytest.mark.parametrize("is_streaming", [True, False])
async def test_announced_function_calls_cannot_silently_disappear_at_completion(
    is_streaming: bool,
) -> None:
    item = _items(1)[0]
    events = [
        _added(0, item),
        _event("response.completed", response=_response([], "completed")),
    ]

    with pytest.raises(ModelUnavailable):
        await _respond(events, is_streaming=is_streaming)
