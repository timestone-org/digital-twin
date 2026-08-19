"""快照缓冲：协议无关的四元组进来，定期原子交换后落 Redis。

数据流见 COLLECT_DESIGN.md §4.3 的 ②④⑤；归档那一支（③⑥⑦）在 archive/。
"""

import asyncio
import contextlib
import json
from collections.abc import Mapping, Sequence
from uuid import UUID

from collector_server.apps.collect import tuning
from collector_server.apps.collect.drivers.base import Sample, ValueSink
from collector_server.apps.collect.tuning import PlanView
from collector_server.snapshot import SnapshotStore
from collectwire import (
    FIELD_QUALITY,
    FIELD_TIMESTAMP_MS,
    FIELD_VALUE,
    CollectPlan,
)
from lib.errors import AppError
from lib.logging import get_logger
from timeseries import Quality

_logger = get_logger("collect.sink")

# 一次 flush 之间的最小间隔下限，防止把配置写成 0 之后空转打满 CPU
MIN_FLUSH_INTERVAL_MS = 50


class ValueBuffer:
    """一个数据源的窗口缓冲。

    ⚠ 窗口内同一点位**后值覆盖前值**：快照是采样，不是事件流。要每一次变化
    的是归档那一支，两者的取舍不同，不许合成一个。
    """

    def __init__(self) -> None:
        self._values: dict[str, Sample] = {}

    def record(
        self, point_code: str, value: object, ts_ms: int, quality: Quality
    ) -> None:
        """记一次读数。

        ⚠ **纯同步、零 await**：它跑在协议库的回调里（COLLECT_DESIGN.md §4.1）。
        也正因为零 await，`swap()` 不会在换到一半时被打断，因此不需要锁。

        Args: point_code, value, ts_ms, quality。
        """
        self._values[point_code] = (value, ts_ms, quality)

    def swap(self) -> dict[str, Sample]:
        """取走这一窗的全部读数，并换上一个空字典。"""
        pending, self._values = self._values, {}
        return pending

    def size(self) -> int:
        """当前窗内的点位数。"""
        return len(self._values)


def fan_out(first: ValueSink, second: ValueSink) -> ValueSink:
    """把同一条读数并联喂给两条支线：快照与归档。

    ⚠ 合出来的回调必须仍是**纯同步、零 await** 的（COLLECT_DESIGN.md §4.1）：
    它跑在协议库的回调里。两条支线的取舍不同——快照后值覆盖前值，归档按准入
    规则每条都留——所以是并联两个缓冲，不是共用一个。

    Args: first, second。
    """

    def record(
        point_code: str, value: object, ts_ms: int, quality: Quality
    ) -> None:
        first(point_code, value, ts_ms, quality)
        second(point_code, value, ts_ms, quality)

    return record


def encode_fields(pending: Mapping[str, Sample]) -> dict[str, str]:
    """把一窗读数编成哈希字段。字段名取自 `collectwire`，读侧用的是同一份。

    Args: pending。
    """
    return {
        point_code: json.dumps(
            {
                FIELD_VALUE: value,
                FIELD_TIMESTAMP_MS: ts_ms,
                FIELD_QUALITY: quality,
            },
            ensure_ascii=False,
            separators=(",", ":"),
            # 现场可能给出 datetime 一类不可序列化的值，落成字符串好过丢掉整窗
            default=str,
        )
        for point_code, (value, ts_ms, quality) in pending.items()
    }


class SnapshotSink:
    """全部数据源的窗口缓冲，加一条定期落 Redis 的循环。"""

    def __init__(
        self,
        *,
        store: SnapshotStore,
        interval_ms: int,
        ttl_s: int,
        plan: PlanView | None = None,
    ) -> None:
        """按存储面与周期初始化，构造时不起任何任务。

        `interval_ms` / `ttl_s` 是环境变量给的默认值；给了 `plan` 时每一拍
        先看计划里的运行参数覆盖值（即时档：不必重启就生效）。
        Args: store, interval_ms, ttl_s, plan。
        """
        self._store = store
        self._interval_ms = interval_ms
        self._ttl_s = ttl_s
        self._plan = plan
        self._buffers: dict[UUID, ValueBuffer] = {}
        # ⚠ flush 与清理互斥：写键与删键走的是两条连接，交错了就会让一个已经
        # 停采的数据源被自己的尾帧重新写回去，那份值还要再当一个 TTL 的实时值
        self._lock = asyncio.Lock()
        self._stopped = asyncio.Event()
        # ⚠ 强引用：事件循环只持有任务的弱引用，丢了引用的任务可能随时消失
        self._task: asyncio.Task[None] | None = None
        self._dropped = 0

    @property
    def dropped(self) -> int:
        """因写入失败被丢掉的读数条数。静默丢弃最难查，所以要能读出来。"""
        return self._dropped

    def sink_for(self, source_id: UUID) -> ValueSink:
        """取一个数据源的 ValueSink，交给驱动当回调。

        Args: source_id。
        """
        buffer = self._buffers.setdefault(source_id, ValueBuffer())
        return buffer.record

    async def start(self) -> None:
        """起 flush 循环。"""
        self._stopped.clear()
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        """停循环并把**尾帧**冲刷出去。

        ⚠ 尾帧不能丢：collector 是链路末端，退出时缓冲里的数据没有第二个来源
        （runtime-resilience §8）。
        """
        self._stopped.set()
        task, self._task = self._task, None
        if task is not None:
            await task
        await self.flush_once()

    async def flush_once(self) -> None:
        """清掉退出计划的数据源，再把这一窗的读数整批写进 Redis。"""
        async with self._lock:
            await self._prune()
            pending: dict[UUID, dict[str, Sample]] = {}
            quiet: list[UUID] = []
            for source_id, buffer in list(self._buffers.items()):
                window = buffer.swap()
                if window:
                    pending[source_id] = window
                else:
                    quiet.append(source_id)
            await self._write(pending)
            await self._keepalive(quiet)

    async def _keepalive(self, source_ids: Sequence[UUID]) -> None:
        """给这一窗没有新读数的数据源续一次存活期。

        ⚠ 少了这一步，一个「一天变一次」的点位会在 TTL 到期时**整片消失**：
        订阅只在值变化时回调，值不变就没有写入、也就没人续期，而界面分不清
        「这个点位没有值」与「它的值一直没变」。
        ⚠ 续期不等于凭空造键：EXPIRE 打在不存在的键上什么都不做，所以从没上报
        过读数的数据源不会因为保活冒出一个空快照。
        ⚠ 只要采集进程还活着就续：因此「键还在」说的是「collector 还在管这个
        数据源」，**不是**「现场设备此刻连着」——设备断没断由数据源运行态说
        （`SourceStatus`），不由值的年龄猜。

        Args: source_ids。
        """
        if not source_ids:
            return
        try:
            await self._store.touch(source_ids, ttl_s=self._ttl_s_now())
        except Exception as error:
            _logger.warning(
                "snapshot_keepalive_failed",
                "快照续期失败，静默的数据源可能在 TTL 到期后暂时读不到",
                sources=len(source_ids),
                error_type=type(error).__name__,
            )

    async def _prune(self) -> None:
        """把已经不在计划里的数据源连缓冲带快照一起清掉。

        ⚠ 停采的数据源必须**立刻**没有当前值，不能只等 TTL 到期：那段时间里
        大屏与配置页上它看起来还在实时刷新，而现场其实早就断开了——「返回陈旧
        数据必须标注为陈旧」，而已经停采的值连标注的资格都没有
        （runtime-resilience §9）。下一次启用时值由重新建立的会话现产。
        ⚠ 依据是计划而不是会话有没有拆完：会话拆除有它自己的时序与失败，而计划
        是唯一真源，每一拍都按它对一次账。
        ⚠ 拿不到计划就什么都不清：那时「计划里没有它」说的是我们不知道，不是
        它不该被采（ADR-0001）。
        """
        plan = self._current_plan()
        if plan is None:
            return
        wanted = {source.source_id for source in plan.sources}
        for source_id in list(self._buffers):
            if source_id not in wanted:
                await self._forget(source_id)

    async def _forget(self, source_id: UUID) -> None:
        """丢掉一个数据源的缓冲，并删掉它在 Redis 上的快照。

        ⚠ 删不掉只记日志不抛：清理失败不该带走整条 flush 循环。缓冲已经丢了，
        没人再续它的 TTL，那把键回收的就是 TTL 本身。

        Args: source_id。
        """
        self._buffers.pop(source_id, None)
        try:
            await self._store.drop(source_id)
        except AppError as error:
            _logger.warning(
                "snapshot_drop_failed",
                "停采数据源的快照没能删掉，改由 TTL 到期回收",
                source_id=str(source_id),
                error_type=type(error).__name__,
            )
            return
        _logger.info(
            "snapshot_dropped",
            "数据源已退出计划，快照已清除",
            source_id=str(source_id),
        )

    async def _write(
        self, pending: Mapping[UUID, Mapping[str, Sample]]
    ) -> None:
        """把这一窗各数据源的读数整批写出去。

        ⚠ **一批一个往返**：按数据源逐个写会让一拍的耗时随数据源数线性涨，
        而窗口默认只有 300ms。整批是一次 MULTI/EXEC，成败也因此是整批的——
        日志记的是这一批盖了几个数据源，不再是哪一个失败了。
        ⚠ 写失败**绝不许抛回采集热路径**：采集断了是事故，快照断了是降级
        （COLLECT_DESIGN.md §4.3）。丢了多少条要计数上报——静默丢弃是参考
        实现里最难查的那类问题。
        ⚠ 收的是 `Exception` 不是 `AppError`：Redis 客户端不只抛 RedisError，
        而漏网的那一类会顺着 flush 逃出去带走整条循环——快照就此永久停摆，
        而进程还活着、探针还绿着。

        Args: pending（数据源 → 这一窗的读数）。
        """
        if not pending:
            return
        try:
            await self._store.write_many(
                {
                    source_id: encode_fields(window)
                    for source_id, window in pending.items()
                },
                ttl_s=self._ttl_s_now(),
            )
        except Exception as error:
            dropped = sum(len(window) for window in pending.values())
            self._dropped += dropped
            _logger.error(
                "snapshot_write_failed",
                "快照写入失败，本窗读数已丢弃",
                sources=len(pending),
                dropped=dropped,
                dropped_total=self._dropped,
                error_type=type(error).__name__,
            )

    async def _loop(self) -> None:
        """按周期 flush，直到被叫停。周期每拍现取，运行参数改了下一拍就生效。"""
        while not self._stopped.is_set():
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(
                    self._stopped.wait(), timeout=self._interval_s_now()
                )
            await self.flush_once()

    def _interval_s_now(self) -> float:
        """此刻的 flush 周期：计划覆盖值优先，环境变量兜底。"""
        override = tuning.int_param(
            self._current_plan(),
            tuning.SECTION_COLLECT,
            tuning.KEY_SNAPSHOT_FLUSH_MS,
        )
        interval_ms = override if override is not None else self._interval_ms
        return max(interval_ms, MIN_FLUSH_INTERVAL_MS) / 1000

    def _ttl_s_now(self) -> int:
        """此刻的快照 TTL：计划覆盖值优先，环境变量兜底。"""
        override = tuning.int_param(
            self._current_plan(),
            tuning.SECTION_COLLECT,
            tuning.KEY_SNAPSHOT_TTL_S,
        )
        return override if override is not None else self._ttl_s

    def _current_plan(self) -> CollectPlan | None:
        return None if self._plan is None else self._plan.current
