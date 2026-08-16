"""队列信封的用例 —— 守的是 traceparent 与「读不懂就说读不懂」。

⚠ 信封里没有 traceparent，链路会在「任务提交」处齐刷刷断掉，而这恰恰是最需要
追的异步部分（docs/agents/observability.md §4.2）。
"""

import uuid

from lib.logging import (
    bind_log_context,
    current_traceparent,
    reset_log_context,
)
from platform_server.apps.hvac.services.ac_startup_queue import (
    ENVELOPE_VERSION,
    ShardMessage,
    decode,
)

BATCH_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
ROOM_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")
TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"


def make_message() -> ShardMessage:
    """一条完整的分片任务。"""
    return ShardMessage(
        batch_id=BATCH_ID,
        room_id=ROOM_ID,
        month="2026-02",
        traceparent=TRACEPARENT,
    )


def test_the_envelope_carries_traceparent() -> None:
    """⚠ 链路要跨过队列这一跳，靠的就是信封里这一条。"""
    assert make_message().to_fields()["traceparent"] == TRACEPARENT


def test_the_envelope_round_trips() -> None:
    """编码再解码回到原样，字段名漂了就会在这里红。"""
    assert decode(make_message().to_fields()) == make_message()


def test_the_envelope_fields_are_all_strings() -> None:
    """流里只能放扁平的字符串键值。"""
    fields = make_message().to_fields()
    assert all(isinstance(value, str) for value in fields.values())
    assert fields["envelope_version"] == ENVELOPE_VERSION


def test_the_envelope_does_not_carry_the_time_window() -> None:
    """⚠ 区间不进信封：参数一变，躺在队列里的老消息会跑出另一套规则的结果。"""
    assert set(make_message().to_fields()) == {
        "envelope_version",
        "batch_id",
        "room_id",
        "month",
        "traceparent",
    }


def test_a_message_from_another_envelope_version_is_unreadable() -> None:
    """版本对不上就说读不懂，不猜字段。"""
    fields = make_message().to_fields() | {"envelope_version": "99"}
    assert decode(fields) is None


def test_a_message_missing_a_field_is_unreadable() -> None:
    """缺字段的消息不能当成跑完了。"""
    fields = make_message().to_fields()
    del fields["month"]
    assert decode(fields) is None


def test_a_message_with_a_broken_id_is_unreadable() -> None:
    """id 不是 UUID 时不抛，交给调用方记成失败。"""
    fields = make_message().to_fields() | {"batch_id": "not-a-uuid"}
    assert decode(fields) is None


def test_an_empty_id_is_unreadable() -> None:
    """空串同样读不懂。"""
    fields = make_message().to_fields() | {"room_id": ""}
    assert decode(fields) is None


def test_the_traceparent_follows_the_current_context() -> None:
    """有上下文时沿用它的 trace，链路才连得起来。"""
    token = bind_log_context(
        trace_id="4bf92f3577b34da6a3ce929d0e0e4736",
        span_id="00f067aa0ba902b7",
    )
    try:
        assert current_traceparent() == TRACEPARENT
    finally:
        reset_log_context(token)


def test_a_traceparent_is_minted_when_there_is_no_context() -> None:
    """没有上下文时现开一条链路，而不是发一条没有 trace 的消息。"""
    minted = current_traceparent()
    assert minted.startswith("00-")
    assert len(minted.split("-")) == 4
