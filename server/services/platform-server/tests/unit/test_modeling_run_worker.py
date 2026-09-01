"""运行消费循环：取、跑、确认，以及关停与读不懂的消息。

⚠ 循环本身不认识数据库：编排是注入的，用例给一个记账的假件就验得完。
"""

import asyncio
import uuid
from dataclasses import dataclass, field

import pytest

from platform_server.apps.modeling.services import run_queue
from platform_server.apps.modeling.services.run_pool import NodePool
from platform_server.apps.modeling.services.run_worker import (
    RunConsumer,
    RunConsumerOptions,
)
from platform_server.stream import StreamGroup
from unit.source_fakes import InMemoryStream

TARGET = StreamGroup(
    stream="platform:modeling:run", group="modeling-runners", consumer="one"
)
BLOCK_MS = 5
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
    error: Exception | None = None

    async def __call__(self, *_args: object, **kwargs: object) -> object:
        run_id = kwargs["run_id"]
        assert isinstance(run_id, uuid.UUID)
        self.seen.append(run_id)
        if self.error is not None:
            raise self.error
        return _Report()


@dataclass(frozen=True)
class _Report:
    outcome: str = "done"
    status: str = "succeeded"


def consumer_of(stream: InMemoryStream) -> RunConsumer:
    """造一个消费者。

    Args: stream。
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
            tz_offset_minutes=480,
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
    consumer = consumer_of(stream)
    await consumer._tick()
    assert dispatch.seen == [run_id]
    assert len(stream.acked) == 1


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


async def test_an_orchestration_error_keeps_the_loop_alive(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """编排抛异常时记录并确认——一次抖动不该让整条消费循环停掉。"""
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
    assert len(stream.acked) == 1


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
