"""合并窗口与分片。

⚠ 这一层守的是节流的**语义**：窗口内同一个节点只留最后一个值。上位机可以
每秒写几十次同一个点，逐次推会打爆通道，而中间那些值对看曲线的人没有意义。
"""

import asyncio
import uuid
from collections.abc import Callable

from lib.logging.context import bind_log_context, reset_log_context
from opcua_server.apps.instance.services.value_publisher import (
    ValuePublisher,
    _shards,
)

INSTANCE = uuid.UUID("3fa85f64-5717-4562-b3fc-2c963f66afa6")
OTHER = uuid.UUID("7c9e6679-7425-40de-944b-e07fc1f90ae7")

CONDITION_TIMEOUT_S = 5.0
CONDITION_POLL_S = 0.01


async def _eventually(predicate: Callable[[], bool]) -> bool:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + CONDITION_TIMEOUT_S
    while loop.time() < deadline:
        if predicate():
            return True
        await asyncio.sleep(CONDITION_POLL_S)
    return predicate()


class FakeRealtime:
    """记下每次推送的假 hub 客户端。"""

    def __init__(self, *, is_up: bool = True) -> None:
        self.calls: list[tuple[uuid.UUID, list[dict[str, object]]]] = []
        self.traces: list[str | None] = []
        self._is_up = is_up

    async def publish(
        self,
        instance_id: uuid.UUID,
        items: list[dict[str, object]],
        *,
        traceparent: str | None = None,
    ) -> bool:
        self.calls.append((instance_id, items))
        self.traces.append(traceparent)
        return self._is_up


def _publisher(
    realtime: FakeRealtime, *, max_items: int = 500
) -> ValuePublisher:
    return ValuePublisher(
        realtime=realtime,  # type: ignore[arg-type]  # 结构相同的假件
        window_ms=1000,
        max_items=max_items,
    )


async def test_the_window_keeps_only_the_last_value_per_node() -> None:
    realtime = FakeRealtime()
    publisher = _publisher(realtime)
    for value in (1, 2, 3):
        await publisher.record(INSTANCE, "temp", value)
    await publisher.flush()
    assert realtime.calls == [(INSTANCE, [{"identifier": "temp", "value": 3}])]


async def test_different_nodes_are_all_kept() -> None:
    realtime = FakeRealtime()
    publisher = _publisher(realtime)
    await publisher.record(INSTANCE, "temp", 1)
    await publisher.record(INSTANCE, "flow", 2)
    await publisher.flush()
    _target, items = realtime.calls[0]
    assert {item["identifier"] for item in items} == {"temp", "flow"}


async def test_each_instance_gets_its_own_batch() -> None:
    # ⚠ 主题是按实例分的，两个实例的值不能混进同一条消息
    realtime = FakeRealtime()
    publisher = _publisher(realtime)
    await publisher.record(INSTANCE, "temp", 1)
    await publisher.record(OTHER, "temp", 2)
    await publisher.flush()
    assert {call[0] for call in realtime.calls} == {INSTANCE, OTHER}
    assert len(realtime.calls) == 2


async def test_flushing_twice_does_not_resend() -> None:
    realtime = FakeRealtime()
    publisher = _publisher(realtime)
    await publisher.record(INSTANCE, "temp", 1)
    await publisher.flush()
    await publisher.flush()
    assert len(realtime.calls) == 1


async def test_an_oversized_batch_is_sharded_by_the_publisher() -> None:
    # ⚠ 分片在推送方做：hub 拒收超限载荷，正是要求这一层自己切
    realtime = FakeRealtime()
    publisher = _publisher(realtime, max_items=2)
    for index in range(5):
        await publisher.record(INSTANCE, f"n{index}", index)
    await publisher.flush()
    assert [len(items) for _target, items in realtime.calls] == [2, 2, 1]


async def test_a_failed_shard_stops_that_batch_without_retrying() -> None:
    # ⚠ 一条链路只有一层负责重试：这里重推会与下一个窗口抢顺序，
    # 客户端据 seq 发现缺口后自己补
    realtime = FakeRealtime(is_up=False)
    publisher = _publisher(realtime, max_items=2)
    for index in range(5):
        await publisher.record(INSTANCE, f"n{index}", index)
    await publisher.flush()
    assert len(realtime.calls) == 1


async def test_stop_flushes_what_is_still_pending() -> None:
    # ⚠ 关停要把最后一批冲出去，否则那一窗口的值静默丢掉
    realtime = FakeRealtime()
    publisher = _publisher(realtime)
    await publisher.start()
    await publisher.record(INSTANCE, "temp", 9)
    await publisher.stop()
    assert realtime.calls == [(INSTANCE, [{"identifier": "temp", "value": 9}])]


def test_shards_never_lose_an_item() -> None:
    items = [{"identifier": f"n{index}"} for index in range(7)]
    assert [item for shard in _shards(items, 3) for item in shard] == items


async def test_starting_twice_is_idempotent() -> None:
    realtime = FakeRealtime()
    publisher = _publisher(realtime)
    await publisher.start()
    await publisher.start()
    await publisher.stop()
    assert realtime.calls == []


async def test_the_trace_is_captured_when_recording_not_when_flushing() -> None:
    """⚠ 冲刷跑在后台任务里，那时请求上下文早已不在。

    不在 record 时捕获的话，推出去的 traceparent 是一串全零——链路从写值
    那一刻就断了，而两边的日志都不会报错。
    """
    realtime = FakeRealtime()
    publisher = _publisher(realtime)
    token = bind_log_context(trace_id="a" * 32, span_id="b" * 16)
    try:
        await publisher.record(INSTANCE, "temp", 1)
    finally:
        reset_log_context(token)
    await publisher.flush()
    assert realtime.traces == [f"00-{'a' * 32}-{'b' * 16}-01"]


class ExplodingRealtime:
    """publish 一律抛异常的假 hub 客户端。"""

    def __init__(self) -> None:
        self.calls = 0
        self.last: tuple[uuid.UUID, list[dict[str, object]], str | None] | None
        self.last = None

    async def publish(
        self,
        instance_id: uuid.UUID,
        items: list[dict[str, object]],
        *,
        traceparent: str | None = None,
    ) -> bool:
        self.calls += 1
        self.last = (instance_id, items, traceparent)
        raise RuntimeError("boom")


async def test_the_loop_flushes_on_the_window_cadence() -> None:
    # 只 record 不手动 flush：值要靠窗口循环自己推出去
    realtime = FakeRealtime()
    publisher = ValuePublisher(
        realtime=realtime,  # type: ignore[arg-type]  # 结构相同的假件
        window_ms=10,
        max_items=500,
    )
    await publisher.start()
    try:
        await publisher.record(INSTANCE, "temp", 1)
        assert await _eventually(lambda: bool(realtime.calls))
    finally:
        await publisher.stop()


async def test_a_flush_failure_does_not_stop_the_loop() -> None:
    # ⚠ 一次 hub 抖动不该让同进程的全部实例从此再也不推值
    realtime = ExplodingRealtime()
    publisher = ValuePublisher(
        realtime=realtime,  # type: ignore[arg-type]  # 结构相同的假件
        window_ms=10,
        max_items=500,
    )
    await publisher.start()
    try:
        await publisher.record(INSTANCE, "temp", 1)
        assert await _eventually(lambda: realtime.calls >= 1)
        # 上一轮炸了之后，新的值仍然要被下一轮推出去
        await publisher.record(INSTANCE, "temp", 2)
        assert await _eventually(lambda: realtime.calls >= 2)
    finally:
        await publisher.stop()
