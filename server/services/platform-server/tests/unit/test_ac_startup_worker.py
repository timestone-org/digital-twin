"""消费循环的用例：确认、链路恢复、失败不致命、关停顺序。

⚠ 守的是「跑到一半就退且已经确认」绝不能发生：停收新活之后手上那条要跑完，
没跑完的一律不确认，留给别的消费者认领回去（runtime-resilience.md §8）。
"""

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import cast

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import Database
from lib.errors import DependencyUnavailable
from lib.logging import current_log_context
from lib.stream import StreamEntry, StreamGroup, StreamLike
from platform_server.apps.hvac.services import (
    ac_startup_service,
    ac_startup_worker,
)
from platform_server.apps.hvac.services.ac_source_reader import AcSourceReader
from platform_server.apps.hvac.services.ac_startup_extract import (
    SHARD_RUN_EXTRACTED,
    SHARD_RUN_ORPHANED,
    SHARD_RUN_SKIPPED,
    ExtractionContext,
    ShardRun,
)
from platform_server.apps.hvac.services.ac_startup_queue import ShardMessage
from platform_server.apps.hvac.services.ac_startup_rules import ExtractionRules
from platform_server.apps.hvac.services.ac_startup_worker import (
    ConsumerOptions,
    ShardConsumer,
)

TARGET = StreamGroup(stream="s", group="g", consumer="c")
TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736"
TRACEPARENT = f"00-{TRACE_ID}-00f067aa0ba902b7-01"
BATCH_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
ROOM_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")


@dataclass
class FakeDatabase:
    """只提供 `session()` 的假库：消费循环不碰它以外的任何东西。"""

    opened: int = 0

    @asynccontextmanager
    async def session(self) -> AsyncIterator[AsyncSession]:
        self.opened += 1
        yield cast(AsyncSession, object())


@dataclass
class FakeStream:
    """按批回放消息，并记下确认过哪些。"""

    batches: list[list[StreamEntry]] = field(
        default_factory=list[list[StreamEntry]]
    )
    claims: list[list[StreamEntry]] = field(
        default_factory=list[list[StreamEntry]]
    )
    acked: list[str] = field(default_factory=list[str])
    groups: list[str] = field(default_factory=list[str])
    reads: list[tuple[str, int, int]] = field(
        default_factory=list[tuple[str, int, int]]
    )
    failure: Exception | None = None
    on_empty: Callable[[], None] | None = None
    published: int = 0

    async def publish(self, stream: str, fields: dict[str, str]) -> str:
        self.published += 1
        return f"{stream}:{len(fields)}"

    async def ensure_group(self, target: StreamGroup) -> None:
        self.groups.append(target.group)

    async def read_group(
        self, target: StreamGroup, *, count: int, block_ms: int
    ) -> list[StreamEntry]:
        self.reads.append((target.group, count, block_ms))
        if self.failure is not None:
            raise self.failure
        if self.batches:
            return self.batches.pop(0)
        if self.on_empty is not None:
            self.on_empty()
        return []

    async def claim_stale(
        self, target: StreamGroup, *, min_idle_ms: int, count: int
    ) -> list[StreamEntry]:
        self.reads.append((target.group, count, min_idle_ms))
        return self.claims.pop(0) if self.claims else []

    async def ack(self, target: StreamGroup, entry_id: str) -> None:
        self.groups.append(target.group)
        self.acked.append(entry_id)

    async def close(self) -> None:
        self.batches.clear()


def entry(entry_id: str, *, month: str = "2026-01") -> StreamEntry:
    """一条完整的分片消息。

    Args: entry_id, month。
    """
    return StreamEntry(
        entry_id=entry_id,
        fields=ShardMessage(
            batch_id=BATCH_ID,
            room_id=ROOM_ID,
            month=month,
            traceparent=TRACEPARENT,
        ).to_fields(),
    )


def build_consumer(stream: FakeStream) -> ShardConsumer:
    """一个装着假件的消费者。

    Args: stream。
    """
    return ShardConsumer(
        database=cast(Database, FakeDatabase()),
        stream=cast(StreamLike, stream),
        # cast 的理由：这一层的用例不会走到取数，读取面只是个占位
        context=ExtractionContext(
            reader=cast(AcSourceReader, object()),
            rules=ExtractionRules(),
            max_rows=1,
        ),
        options=ConsumerOptions(
            target=TARGET,
            prefetch=4,
            block_ms=10,
            claim_idle_ms=10,
            shard_timeout_s=5.0,
        ),
    )


@pytest.fixture
def calls(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """把跑一片、记失败、收尾三件事换成记录器。"""
    recorded: list[str] = []

    async def fake_run(
        _session: object, _context: object, message: ShardMessage
    ) -> ShardRun:
        recorded.append(f"run:{message.month}:{current_log_context().trace_id}")
        return ShardRun(outcome=SHARD_RUN_EXTRACTED, episode_count=1)

    async def fake_fail(
        _session: object, message: ShardMessage, *, reason: str
    ) -> None:
        recorded.append(f"fail:{message.month}:{reason[:4]}")

    async def fake_finalize(_session: object, _batch_id: uuid.UUID) -> None:
        recorded.append("finalize")

    monkeypatch.setattr(ac_startup_worker, "run_shard", fake_run)
    monkeypatch.setattr(ac_startup_worker, "fail_shard", fake_fail)
    monkeypatch.setattr(
        ac_startup_worker, "finalize_if_complete", fake_finalize
    )
    return recorded


async def test_a_finished_message_is_acked(calls: list[str]) -> None:
    """跑完了才确认——确认是「这条不必再来一次」的唯一凭据。"""
    stream = FakeStream(batches=[[entry("1-0")]])
    await build_consumer(stream)._tick()
    assert stream.acked == ["1-0"]
    assert calls == [f"run:2026-01:{TRACE_ID}", "finalize"]


async def test_the_trace_is_restored_from_the_envelope(
    calls: list[str],
) -> None:
    """⚠ 链路在异步这一跳靠信封里的 traceparent 接上，漏了它就断在提交处。"""
    await build_consumer(FakeStream(batches=[[entry("1-0")]]))._tick()
    assert calls[0].endswith(TRACE_ID)


async def test_a_skipped_shard_is_not_logged_as_done(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """⚠ 跳过的一片绝不能记成「分片抽取完成」。

    线上 43/45 卡了两轮而没人看出来，正是因为日志替一件没发生的事作了证：
    跳过与跑完共用一个 event，两者在日志里长得一模一样。
    """

    async def skipping(
        _session: object, _context: object, _message: ShardMessage
    ) -> ShardRun:
        return ShardRun(outcome=SHARD_RUN_SKIPPED, reason="批次已不在跑")

    monkeypatch.setattr(ac_startup_worker, "run_shard", skipping)
    monkeypatch.setattr(ac_startup_worker, "finalize_if_complete", _no_finalize)
    stream = FakeStream(batches=[[entry("1-0")]])
    with caplog.at_level(logging.INFO):
        await build_consumer(stream)._tick()
    events = [record.getMessage() for record in caplog.records]
    assert "ac_startup_shard_done" not in events
    assert "ac_startup_shard_skipped" in events
    # 状态已经落库了，这条消息不必再来一次
    assert stream.acked == ["1-0"]


async def test_an_orphaned_shard_is_reported_and_dropped(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """批次连同分片行一起没了：没有可落状态的地方，只能报出来再丢掉。"""

    async def orphaned(
        _session: object, _context: object, _message: ShardMessage
    ) -> ShardRun:
        return ShardRun(outcome=SHARD_RUN_ORPHANED, reason="批次已不存在")

    monkeypatch.setattr(ac_startup_worker, "run_shard", orphaned)
    monkeypatch.setattr(ac_startup_worker, "finalize_if_complete", _no_finalize)
    stream = FakeStream(batches=[[entry("1-0")]])
    with caplog.at_level(logging.INFO):
        await build_consumer(stream)._tick()
    events = [record.getMessage() for record in caplog.records]
    assert "ac_startup_shard_done" not in events
    assert "ac_startup_shard_orphaned" in events
    # 再送一遍也是一样的结果，留在待确认表里只会没完没了
    assert stream.acked == ["1-0"]


async def test_a_cancelled_shard_is_not_acked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """⚠ 宽限期到点被取消的那条消息不许确认。

    确认是「这条不必再来一次」的唯一凭据。跑到一半被取消却确认掉，分片既没落
    状态也没留下任何日志，而 `drain` 的约定恰恰是「没确认，会被别人认领回去」。
    """

    async def cancelled(
        _session: object, _context: object, _message: ShardMessage
    ) -> ShardRun:
        raise asyncio.CancelledError

    monkeypatch.setattr(ac_startup_worker, "run_shard", cancelled)
    monkeypatch.setattr(ac_startup_worker, "finalize_if_complete", _no_finalize)
    stream = FakeStream(batches=[[entry("1-0")]])
    with pytest.raises(asyncio.CancelledError):
        await build_consumer(stream)._tick()
    assert stream.acked == []


async def _no_finalize(_session: object, _batch_id: uuid.UUID) -> None:
    """收尾在这一层不参与断言。"""
    return


async def test_an_unreadable_message_is_acked_without_running(
    calls: list[str],
) -> None:
    """读不懂的消息确认掉，但绝不当成跑完了。"""
    stream = FakeStream(
        batches=[
            [StreamEntry(entry_id="9-0", fields={"envelope_version": "9"})]
        ]
    )
    await build_consumer(stream)._tick()
    assert stream.acked == ["9-0"]
    assert calls == []


async def test_a_failing_shard_is_recorded_and_the_loop_survives(
    calls: list[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """一片抛异常只记成失败；循环必须活着，否则一次抖动就永久停摆。"""

    async def boom(
        _session: object, _context: object, _message: ShardMessage
    ) -> int:
        raise RuntimeError("外部数据源不可用")

    monkeypatch.setattr(ac_startup_worker, "run_shard", boom)
    stream = FakeStream(batches=[[entry("1-0")]])
    await build_consumer(stream)._tick()
    assert calls == ["fail:2026-01:外部数据", "finalize"]
    assert stream.acked == ["1-0"]


async def test_claimed_messages_are_taken_before_new_ones(
    calls: list[str],
) -> None:
    """先认领滞留的再取新的：崩在确认之前的那条不能永远躺着。"""
    assert calls == []
    stream = FakeStream(
        batches=[[entry("2-0", month="2026-02")]],
        claims=[[entry("1-0", month="2026-01")]],
    )
    await build_consumer(stream)._tick()
    assert stream.acked == ["1-0"]


async def test_a_queue_outage_does_not_kill_the_loop(
    calls: list[str],
) -> None:
    """取消息失败时空转一轮再来，不抛给调用方。"""
    stream = FakeStream(failure=DependencyUnavailable("队列暂时不可用"))
    await build_consumer(stream)._tick()
    assert calls == []
    assert stream.acked == []


async def test_stopping_leaves_the_rest_of_the_batch_unacked(
    calls: list[str],
) -> None:
    """⚠ 停收新活之后剩下的消息一律不确认，留给别人认领回去。"""
    stream = FakeStream(batches=[[entry("1-0"), entry("2-0")]])
    consumer = build_consumer(stream)
    consumer.stop()
    await consumer._tick()
    assert stream.acked == []
    assert calls == []


@pytest.mark.usefixtures("calls")
async def test_the_loop_creates_its_group_before_reading() -> None:
    """消费组要先建出来，否则第一个 worker 起不来。"""
    stream = FakeStream()
    consumer = build_consumer(stream)
    consumer.stop()
    await consumer.run()
    assert stream.groups == ["g"]


@pytest.mark.usefixtures("calls")
async def test_draining_returns_once_the_message_in_flight_is_done() -> None:
    """手上没活时 drain 立刻返回。"""
    consumer = build_consumer(FakeStream())
    await asyncio.wait_for(consumer.drain(1.0), timeout=2.0)
    assert consumer._idle.is_set() is True


@pytest.mark.usefixtures("calls")
async def test_draining_gives_up_after_the_grace_period() -> None:
    """在途分片超过宽限期没跑完，drain 放弃等待而不是永远挂着。"""
    consumer = build_consumer(FakeStream())
    consumer._idle.clear()
    await asyncio.wait_for(consumer.drain(0.01), timeout=2.0)
    # 放弃等待不等于跑完了：那条消息没被确认，会被别的消费者认领回去
    assert consumer._idle.is_set() is False


async def test_the_loop_keeps_ticking_until_it_is_told_to_stop(
    calls: list[str],
) -> None:
    """常驻循环要真的循环：处理完一条之后还会再取一次。"""
    stream = FakeStream(batches=[[entry("1-0")]])
    consumer = build_consumer(stream)
    stream.on_empty = consumer.stop
    await consumer.run()
    assert stream.acked == ["1-0"]
    assert calls == [f"run:2026-01:{TRACE_ID}", "finalize"]


@dataclass
class FailingStream(FakeStream):
    """投递必失败的流，用来验证入队失败的去向。"""

    async def publish(self, stream: str, fields: dict[str, str]) -> str:
        raise DependencyUnavailable(f"队列暂时不可用：{stream}/{len(fields)}")


async def test_a_dispatch_that_cannot_reach_the_queue_fails_the_batch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """⚠ 投不出去就把批次判失败，否则它会永远停在「跑中」而没有消息在路上。"""
    failed: list[uuid.UUID] = []

    async def fake_fail(_session: object, batch_id: uuid.UUID) -> None:
        failed.append(batch_id)

    monkeypatch.setattr(ac_startup_service, "fail_batch", fake_fail)
    await ac_startup_service.dispatch_shards(
        cast(StreamLike, FailingStream()),
        cast(Database, FakeDatabase()),
        target=TARGET,
        plan=ac_startup_service.ShardDispatch(
            batch_id=BATCH_ID,
            messages=(
                ShardMessage(
                    batch_id=BATCH_ID,
                    room_id=ROOM_ID,
                    month="2026-01",
                    traceparent=TRACEPARENT,
                ),
            ),
        ),
    )
    assert failed == [BATCH_ID]


async def test_a_dispatch_that_reaches_the_queue_publishes_every_shard() -> (
    None
):
    """能投出去时每一片都要投，少一片就少跑一个月。"""
    stream = FakeStream()
    await ac_startup_service.dispatch_shards(
        cast(StreamLike, stream),
        cast(Database, FakeDatabase()),
        target=TARGET,
        plan=ac_startup_service.ShardDispatch(
            batch_id=BATCH_ID,
            messages=tuple(
                ShardMessage(
                    batch_id=BATCH_ID,
                    room_id=ROOM_ID,
                    month=month,
                    traceparent=TRACEPARENT,
                )
                for month in ("2026-01", "2026-02")
            ),
        ),
    )
    assert stream.published == 2
