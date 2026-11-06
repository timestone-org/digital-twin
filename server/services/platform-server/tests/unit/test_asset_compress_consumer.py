"""模型压缩的消费循环。

⚠ 守三条底线：跑完才确认，成败都算跑完；被取消不算跑完，留给下一次认领；进程
死掉留下的消息要有人认领，且认领门槛不能短到抢走还在跑的任务。
"""

import asyncio
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast

import pytest

from lib.stream import StreamEntry, StreamGroup
from platform_server.apps.assets import variants
from platform_server.apps.assets.services import compress_worker
from platform_server.apps.assets.services.compress_queue import new_message

ASSET_ID = uuid.UUID("0192f0aa-0000-7000-8000-000000000001")
TARGET = StreamGroup(stream="s", group="g", consumer="c")


@dataclass
class FakeStream:
    """按批回放消息，并记下确认过哪些。

    ⚠ 取空时必须回调 `on_empty` 让调用方停循环：真 Redis 会 block 住
    `block_ms`，而这个替身立刻返回——不给出口的话 `run()` 就是一个从不让出
    控制权的死转，测试直接挂死（同 `test_ac_model_worker.FakeStream`）。
    """

    batches: list[list[StreamEntry]] = field(
        default_factory=list[list[StreamEntry]]
    )
    acked: list[str] = field(default_factory=list[str])
    groups: list[str] = field(default_factory=list[str])
    on_empty: Callable[[], None] | None = None
    stale: list[StreamEntry] = field(default_factory=list[StreamEntry])
    claim_idles: list[int] = field(default_factory=list[int])

    async def publish(self, stream: str, fields: dict[str, str]) -> str:
        del fields
        return stream

    async def ensure_group(self, target: StreamGroup) -> None:
        self.groups.append(target.group)

    async def read_group(
        self, target: StreamGroup, *, count: int, block_ms: int
    ) -> list[StreamEntry]:
        del target, count, block_ms
        if self.batches:
            return self.batches.pop(0)
        if self.on_empty is not None:
            self.on_empty()
        return []

    async def claim_stale(
        self, target: StreamGroup, *, min_idle_ms: int, count: int
    ) -> list[StreamEntry]:
        del target, count
        self.claim_idles.append(min_idle_ms)
        claimed, self.stale = self.stale, []
        return claimed

    async def ack(self, target: StreamGroup, entry_id: str) -> None:
        del target
        self.acked.append(entry_id)


@dataclass
class SpyCompressor:
    """记下被要求压过哪些素材；可选地抛异常。"""

    seen: list[uuid.UUID] = field(default_factory=list[uuid.UUID])
    is_broken: bool = False

    async def compress(self, asset_id: uuid.UUID) -> None:
        self.seen.append(asset_id)
        if self.is_broken:
            raise RuntimeError("压缩炸了")


def consumer(
    stream: FakeStream, compressor: SpyCompressor
) -> compress_worker.CompressConsumer:
    return compress_worker.CompressConsumer(
        stream=cast(Any, stream),
        compressor=cast(Any, compressor),
        options=compress_worker.CompressOptions(
            target=TARGET, script=Path("/nope.mjs"), node="node", block_ms=1
        ),
    )


def entry(entry_id: str, asset_id: uuid.UUID = ASSET_ID) -> StreamEntry:
    return StreamEntry(
        entry_id=entry_id, fields=new_message(asset_id).to_fields()
    )


async def run_once(
    stream: FakeStream, spy: SpyCompressor
) -> compress_worker.CompressConsumer:
    """跑到把手上那批消化完就停。"""
    loop = consumer(stream, spy)
    stream.on_empty = loop.stop
    await asyncio.wait_for(loop.run(), timeout=5)
    return loop


async def test_a_message_is_handled_then_acked() -> None:
    stream = FakeStream(batches=[[entry("1-1")]])
    spy = SpyCompressor()

    await run_once(stream, spy)

    assert spy.seen == [ASSET_ID]
    assert stream.acked == ["1-1"]


async def test_an_unreadable_message_is_dropped_not_retried() -> None:
    stream = FakeStream(
        batches=[[StreamEntry(entry_id="9-9", fields={"junk": "1"})]]
    )
    spy = SpyCompressor()

    await run_once(stream, spy)

    # 读不懂就丢并确认：不确认的话它会被反复重投，而每次都一样读不懂
    assert spy.seen == []
    assert stream.acked == ["9-9"]


async def test_a_failing_job_is_still_acked() -> None:
    stream = FakeStream(batches=[[entry("2-2")]])
    spy = SpyCompressor(is_broken=True)

    await run_once(stream, spy)

    # ⚠ 失败已经写进那一行了，重投也压不动——不确认就是让它永远转下去
    assert stream.acked == ["2-2"]


async def test_an_entry_left_by_a_dead_consumer_is_picked_up() -> None:
    stream = FakeStream(stale=[entry("3-3")])
    spy = SpyCompressor()

    await run_once(stream, spy)

    # ⚠ 进程被杀时消息留在待确认表里，不认领的话那几档永远停在 pending
    assert spy.seen == [ASSET_ID]
    assert stream.acked == ["3-3"]


async def test_a_running_job_is_never_claimed_away() -> None:
    stream = FakeStream()

    await run_once(stream, SpyCompressor())

    # ⚠ 认领门槛短于跑满全部档的时长的话，别的副本会把还在跑的任务抢走重压
    longest_job_ms = (
        len(variants.derived()) * compress_worker.COMPRESS_TIMEOUT_S * 1000
    )
    assert min(stream.claim_idles) > longest_job_ms


async def test_a_cancelled_job_stays_unacked() -> None:
    started = asyncio.Event()

    @dataclass
    class HungCompressor:
        async def compress(self, asset_id: uuid.UUID) -> None:
            del asset_id
            started.set()
            await asyncio.Event().wait()

    stream = FakeStream(batches=[[entry("4-4")]])
    loop = consumer(stream, cast(Any, HungCompressor()))
    running = asyncio.create_task(loop.run())
    await asyncio.wait_for(started.wait(), timeout=5)

    running.cancel()
    with pytest.raises(asyncio.CancelledError):
        await running

    # ⚠ 宽限期到点被取消的任务没跑完：确认掉的话就再也没有人接手
    assert stream.acked == []
    await asyncio.wait_for(loop.drain(5.0), timeout=2)


async def test_the_consumer_registers_its_group() -> None:
    stream = FakeStream()

    await run_once(stream, SpyCompressor())

    assert stream.groups == [TARGET.group]


async def test_drain_returns_once_the_loop_is_idle() -> None:
    """空闲时 drain 立刻返回，不白等满宽限期。"""
    loop = consumer(FakeStream(), SpyCompressor())

    started = asyncio.get_running_loop().time()
    await asyncio.wait_for(loop.drain(5.0), timeout=2)

    # 手上没活就该立刻回；等满 5s 的话关停会白白拖长那么久
    assert asyncio.get_running_loop().time() - started < 1.0
