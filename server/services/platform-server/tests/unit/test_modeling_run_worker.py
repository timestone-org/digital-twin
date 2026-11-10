"""运行消费循环：取、跑、确认，以及关停与读不懂的消息。

⚠ 循环本身不认识数据库：编排是注入的，用例给一个记账的假件就验得完。
"""

import asyncio
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import pytest

from lib.stream import StreamGroup
from platform_server.apps.modeling.services import run_queue
from platform_server.apps.modeling.services.run_dispatch import (
    DispatchOptions,
    DispatchReport,
)
from platform_server.apps.modeling.services.run_pool import NodePool
from platform_server.apps.modeling.services.run_worker import (
    RunConsumer,
    RunConsumerOptions,
)
from unit.source_fakes import InMemoryStream

TARGET = StreamGroup(
    stream="platform:modeling:run", group="modeling-runners", consumer="one"
)
BLOCK_MS = 5
# 收敛老明细时留几次运行。这一组不真删，只要求消费循环把它传下去
KEEP_PER_PIPELINE = 20

NODE_TIMEOUT_S = 30.0


@dataclass
class RecordingSessions:
    """记账用的会话工厂假件。循环不该碰它，碰了就说明编排没被注入进去。"""

    opened: int = 0

    def session(self) -> object:  # pragma: no cover - 本组用例不该走到
        self.opened += 1
        raise AssertionError("消费循环不该自己开会话")


@dataclass
class RecordingDispatch:
    """把 `execute_run` 换成一个只记账的假件。"""

    seen: list[uuid.UUID] = field(default_factory=list[uuid.UUID])
    offsets: list[int] = field(default_factory=list[int])
    error: Exception | None = None
    outcome: str = "done"

    async def __call__(self, *_args: object, **kwargs: object) -> object:
        run_id = kwargs["run_id"]
        assert isinstance(run_id, uuid.UUID)
        options = kwargs["options"]
        assert isinstance(options, DispatchOptions)
        assert isinstance(options.pool, NodePool)
        self.seen.append(run_id)
        self.offsets.append(options.tz_offset_minutes)
        if self.error is not None:
            raise self.error
        return DispatchReport(outcome=self.outcome, status="succeeded")


def consumer_of(
    stream: InMemoryStream,
    *,
    zone: str = "Asia/Shanghai",
    clock: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> RunConsumer:
    """造一个消费者。

    Args: stream, zone, clock。
    """
    return RunConsumer(
        sessions=RecordingSessions(),  # pyright: ignore[reportArgumentType]
        stream=stream,
        pool=NodePool(factory=_NoPool),
        options=RunConsumerOptions(
            target=TARGET,
            prefetch=1,
            block_ms=BLOCK_MS,
            claim_idle_ms=1000,
            node_timeout_s=NODE_TIMEOUT_S,
            business_zone=ZoneInfo(zone),
            keep_per_pipeline=KEEP_PER_PIPELINE,
            clock=clock,
        ),
    )


class _NoPool:
    """一个从不被用到的执行器：本组用例把编排整个换掉了。"""

    def submit(self, *_args: object, **_kwargs: object) -> object:
        raise AssertionError("本组用例不该真去跑算子")

    def shutdown(self, **_kwargs: object) -> None:
        return None


async def test_a_message_is_processed_then_acked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """确认只在处理走完之后——放进 finally 会把被取消的那条当成跑完了。"""
    stream = InMemoryStream()
    run_id = uuid.uuid4()
    await stream.publish(
        TARGET.stream, run_queue.new_message(run_id).to_fields()
    )
    dispatch = RecordingDispatch()
    monkeypatch.setattr(
        "platform_server.apps.modeling.services.run_worker.execute_run",
        dispatch,
    )
    completed: list[uuid.UUID] = []

    async def finish(
        _sessions: object, identity: uuid.UUID, _store: object
    ) -> None:
        completed.append(identity)

    monkeypatch.setattr(
        "platform_server.apps.modeling.services.run_worker.complete_training",
        finish,
    )
    consumer = consumer_of(stream)
    await consumer._tick()
    assert dispatch.seen == [run_id]
    assert completed == [run_id]
    assert len(stream.acked) == 1


async def test_the_business_offset_follows_daylight_saving_per_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """偏移在启动时冻住的话，夏令时一切换时间特征就整体偏一小时。"""
    moments = iter(
        (datetime(2026, 1, 15, tzinfo=UTC), datetime(2026, 7, 15, tzinfo=UTC))
    )
    stream = InMemoryStream()
    for _ in range(2):
        await stream.publish(
            TARGET.stream, run_queue.new_message(uuid.uuid4()).to_fields()
        )
    dispatch = RecordingDispatch()
    monkeypatch.setattr(
        "platform_server.apps.modeling.services.run_worker.execute_run",
        dispatch,
    )

    async def finish(*_args: object) -> None:
        return None

    monkeypatch.setattr(
        "platform_server.apps.modeling.services.run_worker.complete_training",
        finish,
    )
    consumer = consumer_of(
        stream, zone="Europe/Berlin", clock=lambda: next(moments)
    )
    await consumer._tick()
    await consumer._tick()
    assert dispatch.offsets == [60, 120]


async def test_an_unreadable_message_is_dropped_not_retried(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """读不懂的消息记一条日志就确认丢弃，不能无限重投把循环堵死。"""
    stream = InMemoryStream()
    await stream.publish(TARGET.stream, {"envelope_version": "999"})
    dispatch = RecordingDispatch()
    monkeypatch.setattr(
        "platform_server.apps.modeling.services.run_worker.execute_run",
        dispatch,
    )
    await consumer_of(stream)._tick()
    assert dispatch.seen == []
    assert len(stream.acked) == 1


async def test_a_busy_training_keeps_its_message_unacknowledged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stream = InMemoryStream()
    run_id = uuid.uuid4()
    await stream.publish(
        TARGET.stream, run_queue.new_message(run_id).to_fields()
    )
    dispatch = RecordingDispatch(outcome="busy")
    monkeypatch.setattr(
        "platform_server.apps.modeling.services.run_worker.execute_run",
        dispatch,
    )
    await consumer_of(stream)._tick()
    assert dispatch.seen == [run_id]
    assert stream.acked == []


async def test_publication_failure_keeps_message_pending_and_loop_alive(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stream = InMemoryStream()
    identities = [uuid.uuid4(), uuid.uuid4()]
    for identity in identities:
        await stream.publish(
            TARGET.stream, run_queue.new_message(identity).to_fields()
        )
    dispatch = RecordingDispatch()
    completed: list[uuid.UUID] = []

    async def finish(
        _sessions: object, identity: uuid.UUID, _store: object
    ) -> None:
        if identity == identities[0]:
            raise RuntimeError("数据库暂不可用")
        completed.append(identity)

    monkeypatch.setattr(
        "platform_server.apps.modeling.services.run_worker.execute_run",
        dispatch,
    )
    monkeypatch.setattr(
        "platform_server.apps.modeling.services.run_worker.complete_training",
        finish,
    )
    consumer = consumer_of(stream)
    await consumer._tick()
    assert stream.acked == []
    await consumer._tick()
    assert len(stream.acked) == 1
    assert completed == [identities[1]]


async def test_an_orchestration_error_keeps_the_message_pending(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """终态没落上时不确认：确认了就没有人再收尾，运行卡在 running。"""
    stream = InMemoryStream()
    await stream.publish(
        TARGET.stream, run_queue.new_message(uuid.uuid4()).to_fields()
    )
    dispatch = RecordingDispatch(error=RuntimeError("崩了"))
    monkeypatch.setattr(
        "platform_server.apps.modeling.services.run_worker.execute_run",
        dispatch,
    )
    await consumer_of(stream)._tick()
    assert len(dispatch.seen) == 1
    assert stream.acked == []


async def test_stopping_skips_the_rest_of_the_batch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """收到停止之后不再开新的一条；没确认的会被别人认领回去。"""
    stream = InMemoryStream()
    for _ in range(2):
        await stream.publish(
            TARGET.stream, run_queue.new_message(uuid.uuid4()).to_fields()
        )
    dispatch = RecordingDispatch()
    monkeypatch.setattr(
        "platform_server.apps.modeling.services.run_worker.execute_run",
        dispatch,
    )
    consumer = consumer_of(stream)
    consumer.stop()
    await consumer._tick()
    assert dispatch.seen == []


async def test_drain_returns_once_the_loop_is_idle() -> None:
    """空闲时 drain 立刻返回，不白等一个宽限期。"""
    consumer = consumer_of(InMemoryStream())
    started = asyncio.get_running_loop().time()
    await asyncio.wait_for(consumer.drain(5.0), timeout=2.0)
    assert asyncio.get_running_loop().time() - started < 1.0


async def test_the_envelope_round_trips() -> None:
    """信封编码解码往返，且必须带 traceparent。"""
    run_id = uuid.uuid4()
    fields = run_queue.new_message(run_id).to_fields()
    assert fields["traceparent"]
    decoded = run_queue.decode(fields)
    assert decoded is not None
    assert decoded.run_id == run_id


async def test_an_envelope_without_traceparent_is_rejected() -> None:
    """缺 traceparent 的信封整条拒掉——链路在这一跳齐断比悄悄断好。"""
    fields = run_queue.new_message(uuid.uuid4()).to_fields()
    fields["traceparent"] = ""
    assert run_queue.decode(fields) is None
