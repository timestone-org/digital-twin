"""模型压缩的消费循环：拉原件 → 逐档压 → 传回 → 落行。

⚠ 压缩跑在**子进程**里（Node，见 `nodetools/compress-model.mjs`）：Python 侧没有
可用的 glTF Draco 编码器，这是装 Node 的唯一原因（ADR-0022）。子进程还顺带把
「压到一半 OOM」隔在本进程之外——那时死的是子进程，worker 记一条失败继续干活。

⚠ 消费者必须幂等：队列是 at-least-once，重复投递是常态。判据是那一行的
`status`——已经 `ready` 的直接跳过，不重压。

⚠ 不自动重试：一个压不动的模型重试一万次也压不动，而重试会把 worker 占满。
失败即写 `failed` + 原因，由人在界面上按「重压」（runtime-resilience §4：
一条链路只有一层负责重试）。
"""

import asyncio
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path

from lib.db import Database
from lib.logging import get_logger
from lib.objectstore import ObjectStore, ObjectStoreError
from lib.stream import StreamEntry, StreamGroup, StreamLike
from platform_server.apps.assets import crud, keys, variants
from platform_server.apps.assets.crud.asset_variant import VariantResult
from platform_server.apps.assets.services.compress_queue import decode

_logger = get_logger("platform.assets.compress_worker")

#: 一档压多久算卡死。⚠ 必须有：没有超时的子进程会把这条消费循环永久占住，
#: 而现象是「队列不动了」，看不出是哪一个模型导致的
COMPRESS_TIMEOUT_S = 30 * 60
#: 取消之后再等多久才 kill
KILL_GRACE_S = 5.0


@dataclass(frozen=True)
class CompressOptions:
    """消费者的运行参数。"""

    target: StreamGroup
    #: `nodetools/compress-model.mjs` 的绝对路径
    script: Path
    #: node 可执行文件
    node: str = "node"
    block_ms: int = 5_000
    batch: int = 1


async def run_compressor(
    *, script: Path, node: str, source: Path, output: Path, ratio: float
) -> None:
    """跑一次子进程压缩；非零退出即抛，stderr 原样带出来。

    Args: script, node, source, output, ratio。
    """
    process = await asyncio.create_subprocess_exec(
        node,
        str(script),
        str(source),
        str(output),
        str(ratio),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        async with asyncio.timeout(COMPRESS_TIMEOUT_S):
            _, stderr = await process.communicate()
    except TimeoutError:
        process.kill()
        # ⚠ kill 之后仍要 wait：不回收的话子进程留成僵尸，而 worker 跑几天
        # 之后进程表就满了
        await asyncio.wait_for(process.wait(), KILL_GRACE_S)
        raise RuntimeError("压缩超时，模型可能过大") from None
    if process.returncode != 0:
        reason = stderr.decode("utf-8", "replace").strip()
        raise RuntimeError(reason or "压缩失败")


# ⚠ 文件读写挪进线程：一个 200MB 的模型在事件循环里读一次，这条 worker 上
# 其它所有活都得等着，而现象只是「偶尔所有任务一起变慢」，归因极难
async def _read_file(path: Path) -> bytes:
    return await asyncio.to_thread(path.read_bytes)


async def _write_file(path: Path, data: bytes) -> None:
    await asyncio.to_thread(path.write_bytes, data)


class ModelCompressor:
    """把一个素材的各档压出来并落行。"""

    def __init__(
        self,
        *,
        database: Database,
        store: ObjectStore,
        options: CompressOptions,
    ) -> None:
        self._database = database
        self._store = store
        self._options = options

    async def compress(self, asset_id: uuid.UUID) -> None:
        """压一个素材还没压好的那几档。素材已删或不是模型即静默跳过。

        Args: asset_id。
        """
        pending = await self._pending_variants(asset_id)
        if not pending:
            return
        # ⚠ 原件与派生件都可能是几百 MB，全部落临时目录而不是内存：
        # 一个 200MB 的模型读进内存再压，worker 的常驻内存就再也降不下来
        with tempfile.TemporaryDirectory(prefix="dt-compress-") as workdir:
            root = Path(workdir)
            source = root / "original.glb"
            try:
                await _write_file(
                    source,
                    await self._store.get_bytes(keys.model_key(asset_id)),
                )
            except ObjectStoreError as error:
                await self._fail_all(asset_id, pending, f"取不到原件：{error}")
                return
            for name in pending:
                await self._one(asset_id, name, source, root)

    async def _pending_variants(self, asset_id: uuid.UUID) -> tuple[str, ...]:
        """这个素材还没压好的档。已经 `ready` 的不重压——那是幂等的落点。"""
        async with self._database.session() as session:
            asset = await crud.get(session, asset_id)
            # 素材在消息在路上的时候被删掉了：不是错误，安静收工
            if asset is None or asset.kind != "model":
                return ()
            rows = await crud.asset_variant.list_for_asset(session, asset_id)
        done = {row.variant for row in rows if row.status == "ready"}
        return tuple(name for name in variants.derived() if name not in done)

    async def _one(
        self, asset_id: uuid.UUID, name: str, source: Path, root: Path
    ) -> None:
        """压一档并落行。一档失败不影响后面几档。"""
        spec = variants.spec_of(name)
        if spec is None:  # pragma: no cover - 目录自洽，取不到即代码错
            return
        output = root / f"{name}.glb"
        try:
            await run_compressor(
                script=self._options.script,
                node=self._options.node,
                source=source,
                output=output,
                ratio=spec.simplify_ratio,
            )
            stat = await self._upload(asset_id, name, output)
        except (RuntimeError, ObjectStoreError, OSError) as error:
            _logger.warning(
                "asset_variant_failed",
                "一档压不出来，其余档继续",
                asset_id=str(asset_id),
                variant=name,
                error=error,
            )
            await self._write(asset_id, name, None, str(error))
            return
        await self._write(asset_id, name, stat, "")

    async def _upload(
        self, asset_id: uuid.UUID, name: str, output: Path
    ) -> VariantResult:
        """把压好的字节传上去，并以**存储端读到的**为准回报大小与校验和。"""
        key = keys.model_variant_key(asset_id, name)
        await self._store.put_bytes(
            key, await _read_file(output), content_type="model/gltf-binary"
        )
        stat = await self._store.stat(key)
        if stat is None:  # pragma: no cover - 刚写完就读不到即存储端错
            raise RuntimeError("压缩产物写进去了却读不回来")
        return VariantResult(size_bytes=stat.size_bytes, checksum=stat.etag)

    async def _write(
        self,
        asset_id: uuid.UUID,
        name: str,
        stat: VariantResult | None,
        reason: str,
    ) -> None:
        """把一档的结果落库。⚠ 每档一个事务：压第三档时失败，前两档已经算数。"""
        async with self._database.session() as session:
            if stat is None:
                await crud.asset_variant.mark_failed(
                    session, asset_id, name, reason
                )
            else:
                await crud.asset_variant.mark_ready(
                    session, asset_id, name, stat
                )

    async def _fail_all(
        self, asset_id: uuid.UUID, names: tuple[str, ...], reason: str
    ) -> None:
        for name in names:
            await self._write(asset_id, name, None, reason)


class CompressConsumer:
    """从流里取压缩任务、跑完、确认。

    ⚠ 关停顺序是「停止取新消息 → 跑完手上这条 → 退出」，绝不能跑到一半就退
    且已经确认（docs/agents/runtime-resilience.md §8）。
    """

    def __init__(
        self,
        *,
        stream: StreamLike,
        compressor: ModelCompressor,
        options: CompressOptions,
    ) -> None:
        self._stream = stream
        self._compressor = compressor
        self._options = options
        self._is_stopping = False
        self._idle = asyncio.Event()
        self._idle.set()

    def stop(self) -> None:
        """不再取新消息。手上这条仍然跑完。"""
        self._is_stopping = True

    async def drain(self, timeout_s: float) -> None:
        """等手上那条跑完；超时就放弃等待（消息没确认，会被别人认领回去）。

        Args: timeout_s。
        """
        try:
            async with asyncio.timeout(timeout_s):
                await self._idle.wait()
        except TimeoutError:
            _logger.warning(
                "asset_compress_drain_timeout",
                "在途压缩未能在宽限期内跑完，未确认的消息会被重新认领",
            )

    async def run(self) -> None:
        """常驻循环。⚠ 偶发错误记录后继续，否则一次抖动会让循环永久停止。"""
        await self._stream.ensure_group(self._options.target)
        _logger.info("asset_compress_worker_started", "模型压缩消费者已启动")
        while not self._is_stopping:
            try:
                entries = await self._stream.read_group(
                    self._options.target,
                    count=self._options.batch,
                    block_ms=self._options.block_ms,
                )
            except Exception as error:
                _logger.error(
                    "asset_compress_read_failed", "取压缩任务失败", error=error
                )
                await asyncio.sleep(self._options.block_ms / 1000)
                continue
            for entry in entries:
                await self._handle(entry)

    async def _handle(self, entry: StreamEntry) -> None:
        """跑一条并确认。⚠ 无论成败都确认：失败已经写进那一行，重投也压不动。"""
        self._idle.clear()
        try:
            message = decode(entry.fields)
            if message is None:
                _logger.warning(
                    "asset_compress_message_unreadable",
                    "读不懂的压缩任务，丢弃",
                    entry_id=entry.entry_id,
                )
            else:
                await self._compressor.compress(message.asset_id)
        except Exception as error:
            _logger.error(
                "asset_compress_failed",
                "压缩任务异常，已确认不再重投",
                entry_id=entry.entry_id,
                error=error,
            )
        finally:
            await self._ack(entry)
            self._idle.set()

    async def _ack(self, entry: StreamEntry) -> None:
        try:
            await self._stream.ack(self._options.target, entry.entry_id)
        except Exception as error:
            # 确认失败不致命：这条会被别人认领回去，而消费者是幂等的
            _logger.warning(
                "asset_compress_ack_failed",
                "压缩任务确认失败，会被重新认领",
                entry_id=entry.entry_id,
                error=error,
            )
