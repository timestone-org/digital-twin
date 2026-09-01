"""模型压缩的编排与消费循环。

⚠ 守四条底线：已经压好的档不重压（队列 at-least-once，重投是常态）；一档压不动
不许拖垮后面几档；确认只在处理走完之后；子进程压超时要 kill 并回收，否则 worker
跑几天进程表就满了。
"""

import asyncio
import sys
import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import Database
from lib.stream import StreamEntry, StreamGroup
from lib.testing import FakeObjectStore
from platform_server.apps.assets import keys
from platform_server.apps.assets.services import compress_worker
from platform_server.apps.assets.services.compress_queue import new_message

ASSET_ID = uuid.UUID("0192f0aa-0000-7000-8000-000000000001")
TARGET = StreamGroup(stream="s", group="g", consumer="c")
GLB = b"glTF-ish bytes"


@dataclass
class FakeDatabase:
    """只提供 `session()` 的假库。"""

    opened: int = 0

    @asynccontextmanager
    async def session(self) -> AsyncIterator[AsyncSession]:
        self.opened += 1
        yield cast(AsyncSession, object())


@dataclass
class FakeRow:
    """`asset_model_variants` 的一行，只留用得上的两列。"""

    variant: str
    status: str


@dataclass
class FakeAsset:
    """`assets` 的一行，只留 kind。"""

    kind: str = "model"


@dataclass
class Recorder:
    """记下 service 层往库里写了什么。"""

    ready: list[tuple[str, int]] = field(default_factory=list[tuple[str, int]])
    failed: list[tuple[str, str]] = field(default_factory=list[tuple[str, str]])


def install_fakes(
    monkeypatch: pytest.MonkeyPatch,
    *,
    asset: FakeAsset | None,
    rows: list[FakeRow],
) -> Recorder:
    """把 crud 那一层换成记账用的替身。"""
    recorder = Recorder()

    async def get(_session: Any, _asset_id: uuid.UUID) -> FakeAsset | None:
        return asset

    async def list_for_asset(
        _session: Any, _asset_id: uuid.UUID
    ) -> list[FakeRow]:
        return rows

    async def mark_ready(
        _session: Any, _asset_id: uuid.UUID, variant: str, result: Any
    ) -> None:
        recorder.ready.append((variant, result.size_bytes))

    async def mark_failed(
        _session: Any, _asset_id: uuid.UUID, variant: str, reason: str
    ) -> None:
        recorder.failed.append((variant, reason))

    monkeypatch.setattr(compress_worker.crud, "get", get)
    monkeypatch.setattr(
        compress_worker.crud.asset_variant, "list_for_asset", list_for_asset
    )
    monkeypatch.setattr(
        compress_worker.crud.asset_variant, "mark_ready", mark_ready
    )
    monkeypatch.setattr(
        compress_worker.crud.asset_variant, "mark_failed", mark_failed
    )
    return recorder


def build(store: FakeObjectStore) -> compress_worker.ModelCompressor:
    return compress_worker.ModelCompressor(
        database=cast(Database, FakeDatabase()),
        store=cast(Any, store),
        options=compress_worker.CompressOptions(
            target=TARGET, script=Path("/nope.mjs"), node="node"
        ),
    )


async def store_with_original() -> FakeObjectStore:
    store = FakeObjectStore()
    await store.put_bytes(
        keys.model_key(ASSET_ID), GLB, content_type="model/gltf-binary"
    )
    return store


def fake_compressor(
    monkeypatch: pytest.MonkeyPatch, *, fails: set[str] | None = None
) -> None:
    """把子进程那一步换掉：按目标文件名决定成败，并写出可变长度的字节。"""
    broken = fails or set()

    async def run(
        *, script: Path, node: str, source: Path, output: Path, ratio: float
    ) -> None:
        del script, node, source
        if output.stem in broken:
            raise RuntimeError(f"{output.stem} 压不动")
        # 真实现里这一步也在线程里做：几百 MB 的写在事件循环里会卡住整条 worker
        await asyncio.to_thread(output.write_bytes, b"x" * int(100 * ratio))

    monkeypatch.setattr(compress_worker, "run_compressor", run)


async def test_every_pending_variant_is_compressed_and_recorded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rows = [FakeRow(name, "pending") for name in ("high", "medium", "low")]
    recorder = install_fakes(monkeypatch, asset=FakeAsset(), rows=rows)
    fake_compressor(monkeypatch)
    store = await store_with_original()

    await build(store).compress(ASSET_ID)

    assert sorted(name for name, _ in recorder.ready) == [
        "high",
        "low",
        "medium",
    ]
    # 大小以**存储端读到的**为准，不是子进程自报
    assert dict(recorder.ready)["high"] == 100
    assert await store.stat(keys.model_variant_key(ASSET_ID, "low")) is not None


async def test_variants_already_ready_are_not_recompressed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rows = [
        FakeRow("high", "ready"),
        FakeRow("medium", "pending"),
        FakeRow("low", "ready"),
    ]
    recorder = install_fakes(monkeypatch, asset=FakeAsset(), rows=rows)
    fake_compressor(monkeypatch)

    await build(await store_with_original()).compress(ASSET_ID)

    # ⚠ 这是幂等的落点：队列会重投，已经压好的档重压一遍纯属浪费
    assert [name for name, _ in recorder.ready] == ["medium"]


async def test_one_failing_variant_does_not_stop_the_others(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rows = [FakeRow(name, "pending") for name in ("high", "medium", "low")]
    recorder = install_fakes(monkeypatch, asset=FakeAsset(), rows=rows)
    fake_compressor(monkeypatch, fails={"medium"})

    await build(await store_with_original()).compress(ASSET_ID)

    assert sorted(name for name, _ in recorder.ready) == ["high", "low"]
    assert recorder.failed[0][0] == "medium"
    # 失败原因要留给界面：不给的话重压一遍大概率还是同样的结果
    assert "压不动" in recorder.failed[0][1]


async def test_a_missing_original_fails_every_variant(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rows = [FakeRow(name, "pending") for name in ("high", "medium", "low")]
    recorder = install_fakes(monkeypatch, asset=FakeAsset(), rows=rows)
    fake_compressor(monkeypatch)

    # 桶里没有原件：素材行在、字节没了
    await build(FakeObjectStore()).compress(ASSET_ID)

    assert len(recorder.failed) == 3
    assert recorder.ready == []


async def test_a_deleted_asset_is_a_quiet_no_op(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recorder = install_fakes(monkeypatch, asset=None, rows=[])
    fake_compressor(monkeypatch)

    # 消息在路上时素材被删掉了：不是错误，安静收工
    await build(await store_with_original()).compress(ASSET_ID)

    assert recorder.ready == []
    assert recorder.failed == []


async def test_a_non_model_asset_is_a_quiet_no_op(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    recorder = install_fakes(
        monkeypatch, asset=FakeAsset(kind="image"), rows=[]
    )
    fake_compressor(monkeypatch)

    await build(await store_with_original()).compress(ASSET_ID)

    assert recorder.ready == []
    assert recorder.failed == []


# ---- 子进程那一段：用 python 冒充 node，真的起进程 ----


def script_that(tmp_path: Path, body: str) -> Path:
    path = tmp_path / "fake_tool.py"
    path.write_text(body, encoding="utf-8")
    return path


async def test_a_non_zero_exit_carries_the_stderr_out(tmp_path: Path) -> None:
    script = script_that(
        tmp_path,
        "import sys; sys.stderr.write('模型里没有网格\\n'); sys.exit(1)",
    )

    with pytest.raises(RuntimeError, match="模型里没有网格"):
        await compress_worker.run_compressor(
            script=script,
            node=sys.executable,
            source=tmp_path / "in.glb",
            output=tmp_path / "out.glb",
            ratio=1.0,
        )


async def test_a_silent_failure_still_reports_something(
    tmp_path: Path,
) -> None:
    script = script_that(tmp_path, "import sys; sys.exit(3)")

    # 子进程一声不吭地失败时也要给出一句话，否则界面上是一片空白的「失败」
    with pytest.raises(RuntimeError, match="压缩失败"):
        await compress_worker.run_compressor(
            script=script,
            node=sys.executable,
            source=tmp_path / "in.glb",
            output=tmp_path / "out.glb",
            ratio=1.0,
        )


async def test_a_hung_subprocess_is_killed_and_reaped(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(compress_worker, "COMPRESS_TIMEOUT_S", 0.3)
    script = script_that(tmp_path, "import time; time.sleep(30)")

    # ⚠ kill 之后仍要 wait 回收：不回收就留成僵尸，而 worker 跑几天进程表就满了
    with pytest.raises(RuntimeError, match="超时"):
        await compress_worker.run_compressor(
            script=script,
            node=sys.executable,
            source=tmp_path / "in.glb",
            output=tmp_path / "out.glb",
            ratio=1.0,
        )


# ---- 消费循环 ----


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
        del target, min_idle_ms, count
        return []

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
