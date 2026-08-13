"""训练消费循环与队列信封的用例。

⚠ 守的是与分片消费同一条底线：确认只在处理走完之后，超时与异常都要把失败
落到模型行上而不是让消息静默消失。
"""

import asyncio
import uuid
from collections.abc import AsyncIterator, Callable
from concurrent.futures import Executor
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import cast

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import Database
from lib.errors import DependencyUnavailable
from lib.logging import current_log_context
from platform_server.apps.hvac.services import (
    ac_model_queue,
    ac_model_service,
    ac_model_worker,
)
from platform_server.apps.hvac.services.ac_model_trainer import (
    TRAIN_RUN_FAILED,
    TRAIN_RUN_ORPHANED,
    TRAIN_RUN_TRAINED,
    TrainRun,
)
from platform_server.apps.hvac.services.ac_model_worker import (
    TrainerOptions,
    TrainingConsumer,
)
from platform_server.stream import StreamEntry, StreamGroup, StreamLike

TARGET = StreamGroup(stream="s", group="g", consumer="c")
TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736"
TRACEPARENT = f"00-{TRACE_ID}-00f067aa0ba902b7-01"
MODEL_ID = uuid.UUID("33333333-3333-3333-3333-333333333333")


@dataclass
class FakeDatabase:
    """只提供 `session()` 的假库。"""

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
    failure: Exception | None = None
    on_empty: Callable[[], None] | None = None

    async def publish(self, stream: str, fields: dict[str, str]) -> str:
        del fields
        return stream

    async def ensure_group(self, target: StreamGroup) -> None:
        self.groups.append(target.group)

    async def read_group(
        self, target: StreamGroup, *, count: int, block_ms: int
    ) -> list[StreamEntry]:
        del target, count, block_ms
        if self.failure is not None:
            caught = self.failure
            self.failure = None
            raise caught
        if self.batches:
            return self.batches.pop(0)
        if self.on_empty is not None:
            self.on_empty()
        return []

    async def claim_stale(
        self, target: StreamGroup, *, min_idle_ms: int, count: int
    ) -> list[StreamEntry]:
        del target, min_idle_ms, count
        return self.claims.pop(0) if self.claims else []

    async def ack(self, target: StreamGroup, entry_id: str) -> None:
        del target
        self.acked.append(entry_id)

    async def close(self) -> None:
        self.batches.clear()


def entry(entry_id: str) -> StreamEntry:
    """一条完整的训练消息。

    Args: entry_id。
    """
    return StreamEntry(
        entry_id=entry_id,
        fields=ac_model_queue.TrainMessage(
            model_id=MODEL_ID, traceparent=TRACEPARENT
        ).to_fields(),
    )


def build(stream: FakeStream, *, timeout_s: float = 5.0) -> TrainingConsumer:
    """一个装着假件的训练消费者。

    Args: stream, timeout_s。
    """
    return TrainingConsumer(
        database=cast(Database, FakeDatabase()),
        stream=cast(StreamLike, stream),
        # cast 的理由：这一层的用例把 run_training 整个打了桩，进程池不会被碰
        executor=cast(Executor, object()),
        options=TrainerOptions(
            target=TARGET,
            prefetch=1,
            block_ms=10,
            claim_idle_ms=1000,
            train_timeout_s=timeout_s,
            timezone="Asia/Shanghai",
        ),
    )


async def test_a_trained_message_is_acked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """训完的消息要确认，链路从信封里恢复。"""
    seen: list[tuple[uuid.UUID, str | None]] = []

    async def fake_run(
        database: Database,
        *,
        executor: object,
        timezone: str,
        model_id: uuid.UUID,
    ) -> TrainRun:
        del database, executor, timezone
        seen.append((model_id, current_log_context().trace_id))
        return TrainRun(TRAIN_RUN_TRAINED)

    monkeypatch.setattr(ac_model_worker, "run_training", fake_run)
    stream = FakeStream(batches=[[entry("1-1")]])
    consumer = build(stream)
    await consumer._tick()
    assert stream.acked == ["1-1"]
    assert seen == [(MODEL_ID, TRACE_ID)]


async def test_an_unreadable_message_is_acked_and_dropped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """读不懂的消息确认丢弃：让它无限重放只会淹掉正常任务。"""

    async def fail_run(*args: object, **kwargs: object) -> TrainRun:
        del args, kwargs
        raise AssertionError("不该走到训练")

    monkeypatch.setattr(ac_model_worker, "run_training", fail_run)
    stream = FakeStream(
        batches=[[StreamEntry(entry_id="9-9", fields={"who": "?"})]]
    )
    await build(stream)._tick()
    assert stream.acked == ["9-9"]


async def test_a_training_exception_marks_the_model_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """训练抛异常：失败落到模型行上，消息仍然确认（重放它没有意义）。"""
    failures: list[str] = []

    async def explode(*args: object, **kwargs: object) -> TrainRun:
        del args, kwargs
        raise RuntimeError("拟合炸了")

    async def record(
        database: Database, model_id: uuid.UUID, *, reason: str
    ) -> None:
        del database, model_id
        failures.append(reason)

    monkeypatch.setattr(ac_model_worker, "run_training", explode)
    monkeypatch.setattr(ac_model_worker, "mark_failed", record)
    stream = FakeStream(batches=[[entry("2-2")]])
    await build(stream)._tick()
    assert failures == ["拟合炸了"]
    assert stream.acked == ["2-2"]


async def test_a_timeout_is_recorded_as_a_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """⚠ 训练超时按不可重试处理：标记失败等人重新点，不进重放循环。"""
    failures: list[str] = []

    async def hang(*args: object, **kwargs: object) -> TrainRun:
        del args, kwargs
        await asyncio.sleep(60)
        return TrainRun(TRAIN_RUN_TRAINED)

    async def record(
        database: Database, model_id: uuid.UUID, *, reason: str
    ) -> None:
        del database, model_id
        failures.append(reason)

    monkeypatch.setattr(ac_model_worker, "run_training", hang)
    monkeypatch.setattr(ac_model_worker, "mark_failed", record)
    stream = FakeStream(batches=[[entry("3-3")]])
    await build(stream, timeout_s=0.01)._tick()
    assert len(failures) == 1
    assert "秒" in failures[0]
    assert stream.acked == ["3-3"]


def test_the_envelope_round_trips() -> None:
    """信封编解码往返；traceparent 必须在场。"""
    message = ac_model_queue.TrainMessage(
        model_id=MODEL_ID, traceparent=TRACEPARENT
    )
    assert ac_model_queue.decode(message.to_fields()) == message


@pytest.mark.parametrize(
    "fields",
    [
        {},
        {"envelope_version": "0", "model_id": str(MODEL_ID)},
        {"envelope_version": "1", "model_id": "not-a-uuid"},
        {"envelope_version": "1", "model_id": str(MODEL_ID)},
    ],
)
def test_unreadable_envelopes_decode_to_none(fields: dict[str, str]) -> None:
    """版本不认识、字段残缺或 id 不合法，一律给 None 不猜。"""
    assert ac_model_queue.decode(fields) is None


async def test_the_loop_runs_until_stopped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """常驻循环：消费完一批后由 stop 收口，认领过的滞留消息也要跑。"""

    async def fake_run(*args: object, **kwargs: object) -> TrainRun:
        del args, kwargs
        return TrainRun(TRAIN_RUN_TRAINED)

    monkeypatch.setattr(ac_model_worker, "run_training", fake_run)
    stream = FakeStream(claims=[[entry("0-1")]], batches=[[entry("1-1")]])
    consumer = build(stream)
    stream.on_empty = consumer.stop
    await consumer.run()
    assert stream.acked == ["0-1", "1-1"]
    assert stream.groups[0] == "g"


async def test_a_fetch_failure_is_a_warning_not_a_crash(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """⚠ 队列抖一下不是循环的死刑：记下告警，睡一拍再来。"""

    async def fake_run(*args: object, **kwargs: object) -> TrainRun:
        del args, kwargs
        return TrainRun(TRAIN_RUN_TRAINED)

    monkeypatch.setattr(ac_model_worker, "run_training", fake_run)
    stream = FakeStream(
        failure=DependencyUnavailable("队列暂时不可用"),
        batches=[[entry("2-1")]],
    )
    consumer = build(stream)
    stream.on_empty = consumer.stop
    await consumer.run()
    assert stream.acked == ["2-1"]


async def test_stopping_mid_batch_leaves_the_rest_unacked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """停收新活后手上这条跑完，批里剩下的不确认，由别人认领回去。"""
    consumer_box: list[TrainingConsumer] = []

    async def fake_run(*args: object, **kwargs: object) -> TrainRun:
        del args, kwargs
        consumer_box[0].stop()
        return TrainRun(TRAIN_RUN_TRAINED)

    monkeypatch.setattr(ac_model_worker, "run_training", fake_run)
    stream = FakeStream(batches=[[entry("3-1"), entry("3-2")]])
    consumer = build(stream)
    consumer_box.append(consumer)
    await consumer.run()
    assert stream.acked == ["3-1"]


async def test_drain_waits_out_the_inflight_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """drain 等手上那条跑完才返回；空闲时立即返回。"""
    consumer = build(FakeStream())
    await consumer.drain(0.1)

    release = asyncio.Event()

    async def slow_run(*args: object, **kwargs: object) -> TrainRun:
        del args, kwargs
        await release.wait()
        return TrainRun(TRAIN_RUN_TRAINED)

    monkeypatch.setattr(ac_model_worker, "run_training", slow_run)
    stream = FakeStream(batches=[[entry("4-1")]])
    busy = build(stream)
    tick = asyncio.create_task(busy._tick())
    await asyncio.sleep(0)
    await busy.drain(0.01)
    release.set()
    await tick
    assert stream.acked == ["4-1"]


async def test_failed_and_orphaned_runs_are_logged_not_retried(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """拒训与孤儿都确认丢弃：结果已落库（或无处可落），重放没有意义。"""
    outcomes = [
        TrainRun(TRAIN_RUN_FAILED, reason="样本不够"),
        TrainRun(TRAIN_RUN_ORPHANED, reason="模型已被删除"),
    ]

    async def fake_run(*args: object, **kwargs: object) -> TrainRun:
        del args, kwargs
        return outcomes.pop(0)

    monkeypatch.setattr(ac_model_worker, "run_training", fake_run)
    stream = FakeStream(batches=[[entry("5-1"), entry("5-2")]])
    await build(stream)._tick()
    assert stream.acked == ["5-1", "5-2"]


async def test_a_failed_dispatch_marks_the_model_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """⚠ 投递失败不能让模型永远停在 queued：判失败，页面看得见。"""
    marked: list[str] = []

    @dataclass
    class ExplodingStream:
        async def publish(self, stream: str, fields: dict[str, str]) -> str:
            del stream, fields
            raise DependencyUnavailable("队列暂时不可用")

    async def record(
        database: Database, model_id: uuid.UUID, *, reason: str
    ) -> None:
        del database, model_id
        marked.append(reason)

    monkeypatch.setattr(ac_model_service, "_open_and_fail", None)

    async def fake_open_and_fail(
        database: Database, model_id: uuid.UUID
    ) -> None:
        del database
        marked.append(str(model_id))

    monkeypatch.setattr(ac_model_service, "_open_and_fail", fake_open_and_fail)
    del record
    await ac_model_service.dispatch_training(
        cast(StreamLike, ExplodingStream()),
        cast(Database, FakeDatabase()),
        target=TARGET,
        message=ac_model_queue.TrainMessage(
            model_id=MODEL_ID, traceparent=TRACEPARENT
        ),
    )
    assert marked == [str(MODEL_ID)]
