"""模型压缩的编排与子进程。

⚠ 守四条底线：已经压好的档不重压（队列 at-least-once，重投是常态）；一档压不动
不许拖垮后面几档；确认只在处理走完之后；子进程压超时要 kill 并回收，否则 worker
跑几天进程表就满了。
"""

import asyncio
import os
import sys
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import Database
from lib.stream import StreamGroup
from lib.testing import FakeObjectStore
from platform_server.apps.assets import keys
from platform_server.apps.assets.services import compress_worker

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
    content_revision: uuid.UUID | None = None


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

    async def locked(
        _session: Any, _asset_id: uuid.UUID, revision: uuid.UUID | None
    ) -> bool:
        return asset is not None and asset.content_revision == revision

    monkeypatch.setattr(compress_worker, "lock_revision", locked)
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


class StreamingOnlyStore(FakeObjectStore):
    """整份过内存的读写口一碰就炸：模型走文件流，不许整份进内存。"""

    async def get_bytes(self, key: str) -> bytes:
        raise AssertionError(f"原件整份读进了内存：{key}")

    async def put_bytes(
        self, key: str, data: bytes, *, content_type: str
    ) -> None:
        del data, content_type
        raise AssertionError(f"产物整份读进了内存：{key}")


async def test_models_stream_through_files_instead_of_memory(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rows = [FakeRow(name, "pending") for name in ("high", "medium", "low")]
    recorder = install_fakes(monkeypatch, asset=FakeAsset(), rows=rows)
    fake_compressor(monkeypatch)
    store = StreamingOnlyStore()
    store.objects[keys.model_key(ASSET_ID)] = (GLB, "model/gltf-binary")

    await build(store).compress(ASSET_ID)

    assert recorder.failed == []
    assert len(recorder.ready) == 3


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


async def test_missing_node_identifies_configuration_for_every_variant(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    rows = [FakeRow(name, "pending") for name in ("high", "medium", "low")]
    recorder = install_fakes(monkeypatch, asset=FakeAsset(), rows=rows)
    compressor = compress_worker.ModelCompressor(
        database=cast(Database, FakeDatabase()),
        store=await store_with_original(),
        options=compress_worker.CompressOptions(
            target=TARGET,
            script=script_that(tmp_path, "pass"),
            node=str(tmp_path / "missing-node.exe"),
        ),
    )

    await compressor.compress(ASSET_ID)

    assert recorder.ready == []
    assert {name for name, _ in recorder.failed} == {"high", "medium", "low"}
    for _, reason in recorder.failed:
        assert "PLATFORM_ASSETCOMPRESS_NODE" in reason
        assert "NSSM" in reason


async def test_process_start_failure_keeps_node_configuration_context(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    script = script_that(tmp_path, "pass")
    error = FileNotFoundError("[WinError 2] 系统找不到指定的文件。")
    monkeypatch.setattr(
        asyncio, "create_subprocess_exec", AsyncMock(side_effect=error)
    )

    with pytest.raises(
        RuntimeError, match="PLATFORM_ASSETCOMPRESS_NODE"
    ) as caught:
        await compress_worker.run_compressor(
            script=script,
            node=sys.executable,
            source=tmp_path / "in.glb",
            output=tmp_path / "out.glb",
            ratio=1.0,
        )

    assert "NSSM" in str(caught.value)
    assert "WinError 2" in str(caught.value)


async def test_spaces_and_non_ascii_paths_remain_separate_arguments(
    tmp_path: Path,
) -> None:
    root = tmp_path / "模型 & tools"
    root.mkdir()
    source = root / "原始 模型.glb"
    output = root / "高画质 模型.glb"
    source.write_bytes(GLB)
    script = script_that(
        root,
        "from pathlib import Path\nimport sys\n"
        "Path(sys.argv[2]).write_bytes(Path(sys.argv[1]).read_bytes())\n",
    )

    await compress_worker.run_compressor(
        script=script,
        node=sys.executable,
        source=source,
        output=output,
        ratio=1.0,
    )

    assert output.read_bytes() == GLB


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


def pid_in(path: Path) -> int | None:
    text = path.read_text() if path.exists() else ""
    return int(text) if text else None


async def written_pid(path: Path) -> int:
    """等子进程把自己的 pid 写出来。"""
    for _ in range(1000):
        await asyncio.sleep(0.01)
        found = await asyncio.to_thread(pid_in, path)
        if found is not None:
            return found
    raise AssertionError("子进程没有起来")


async def test_a_cancelled_compression_takes_its_subprocess_down(
    tmp_path: Path,
) -> None:
    pid_file = tmp_path / "pid"
    script = script_that(
        tmp_path,
        "import os, pathlib, sys, time\n"
        f"pathlib.Path({str(pid_file)!r}).write_text(str(os.getpid()))\n"
        "time.sleep(30)\n",
    )
    running = asyncio.create_task(
        compress_worker.run_compressor(
            script=script,
            node=sys.executable,
            source=tmp_path / "in.glb",
            output=tmp_path / "out.glb",
            ratio=1.0,
        )
    )
    pid = await written_pid(pid_file)

    running.cancel()
    with pytest.raises(asyncio.CancelledError):
        await running

    # ⚠ 留着不杀的话，那个孤儿会跟接手的 worker 抢同一批 CPU 与内存
    with pytest.raises(ProcessLookupError):
        os.kill(pid, 0)


async def test_late_compression_does_not_publish_into_a_replaced_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    asset = FakeAsset()
    recorder = install_fakes(monkeypatch, asset=asset, rows=[])
    store = await store_with_original()
    revision = uuid.UUID("0192f0aa-0000-7000-8000-000000000002")
    await store.put_bytes(
        keys.revision_key(ASSET_ID, revision),
        b"new",
        content_type="model/gltf-binary",
    )

    async def finish_old(
        *, script: Path, node: str, source: Path, output: Path, ratio: float
    ) -> None:
        del script, node, source, ratio
        asset.content_revision = revision
        await asyncio.to_thread(output.write_bytes, b"old compressed")

    monkeypatch.setattr(compress_worker, "run_compressor", finish_old)
    await build(store).compress(ASSET_ID)
    assert recorder.ready == []
    assert recorder.failed == []
    assert (
        await store.stat(keys.revision_key(ASSET_ID, revision, "high")) is None
    )
    assert (
        await store.get_bytes(keys.revision_key(ASSET_ID, revision)) == b"new"
    )


async def test_new_content_compression_reads_and_writes_its_own_version(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    revision = uuid.UUID("0192f0aa-0000-7000-8000-000000000002")
    recorder = install_fakes(
        monkeypatch, asset=FakeAsset(content_revision=revision), rows=[]
    )
    fake_compressor(monkeypatch)
    store = FakeObjectStore()
    await store.put_bytes(
        keys.revision_key(ASSET_ID, revision),
        GLB,
        content_type="model/gltf-binary",
    )
    await build(store).compress(ASSET_ID)
    assert len(recorder.ready) == 3
    assert (
        await store.stat(keys.revision_key(ASSET_ID, revision, "high"))
        is not None
    )
    assert await store.stat(keys.model_variant_key(ASSET_ID, "high")) is None
