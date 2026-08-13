"""训练消费循环与队列信封的用例。

⚠ 守的是与分片消费同一条底线：确认只在处理走完之后，超时与异常都要把失败
落到模型行上而不是让消息静默消失。
"""

import asyncio
import uuid
from collections.abc import AsyncIterator
from concurrent.futures import Executor
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import cast

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import Database
from lib.logging import current_log_context
from platform_server.apps.hvac.services import (
    ac_model_queue,
    ac_model_worker,
)
from platform_server.apps.hvac.services.ac_model_trainer import (
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
    acked: list[str] = field(default_factory=list[str])
    groups: list[str] = field(default_factory=list[str])

    async def publish(self, stream: str, fields: dict[str, str]) -> str:
        del fields
        return stream

    async def ensure_group(self, target: StreamGroup) -> None:
        self.groups.append(target.group)

    async def read_group(
        self, target: StreamGroup, *, count: int, block_ms: int
    ) -> list[StreamEntry]:
        del target, count, block_ms
        return self.batches.pop(0) if self.batches else []

    async def claim_stale(
        self, target: StreamGroup, *, min_idle_ms: int, count: int
    ) -> list[StreamEntry]:
        del target, min_idle_ms, count
        return []

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
