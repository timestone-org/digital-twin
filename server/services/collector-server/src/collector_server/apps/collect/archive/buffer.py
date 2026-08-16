"""归档缓冲：准入判定 + 有界缓冲 + 定期落 Redis Stream。

数据流见 COLLECT_DESIGN.md §4.3 的 ③⑥；从 Stream 到库的那一段在 writer.py。
⚠ 本模块只认四元组 `(point_code, value, ts_ms, quality)`，不认识任何驱动。
"""

import asyncio
import contextlib
from collections import deque
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass
from uuid import UUID

from collector_server.apps.collect import tuning
from collector_server.apps.collect.drivers.base import ValueSink
from collector_server.apps.collect.schemas.plan import CollectPlan
from collector_server.apps.collect.tuning import PlanView
from collector_server.stream import ArchiveStream
from lib.logging import get_logger
from timeseries import Quality

_logger = get_logger("collect.archive.buffer")

# 一次 flush 之间的最小间隔下限，防止把配置写成 0 之后空转打满 CPU
MIN_FLUSH_INTERVAL_MS = 50

PointKey = tuple[UUID, str]


@dataclass(frozen=True)
class ArchivePolicy:
    """一个点位的归档准入参数。取值来自计划，口径见 COLLECT_DESIGN.md §4.3。"""

    archive_enabled: bool = True
    deadband: float = 0.0
    max_interval_ms: int = 0


# ⚠ 计划里查不到的点位按「照常归档」处理：计划刚变而索引还没重建的那一瞬，
# 宁可多写几行也不要在库里留一段没人察觉的空白
DEFAULT_POLICY = ArchivePolicy()


@dataclass(frozen=True)
class ArchiveRow:
    """一条待落库的历史。`source_id` 在流键里，不在行里重复。"""

    point_code: str
    value: object
    ts_ms: int
    quality: Quality

    def to_payload(self) -> dict[str, object]:
        """编成 Stream 条目里的一行。

        ⚠ 字段名是 buffer 与 writer 之间的契约，改它要先改契约测试。
        """
        return {
            "point_code": self.point_code,
            "value": self.value,
            "ts_ms": self.ts_ms,
            "quality": self.quality,
        }


def policies_of(plan: CollectPlan) -> dict[PointKey, ArchivePolicy]:
    """把一份计划压成按点位取策略的平表——热路径上只查一次字典。

    Args: plan。
    """
    return {
        (source.source_id, point.point_code): ArchivePolicy(
            archive_enabled=point.archive_enabled,
            deadband=point.deadband,
            max_interval_ms=point.archive_max_interval_ms,
        )
        for source in plan.sources
        for point in source.points
    }


def is_beyond_deadband(
    previous: object, value: object, deadband: float
) -> bool:
    """两个读数之间的差值算不算越过了死区。

    ⚠ 用 `>` 而不是 `>=`：死区 0 的语义是「变了就记」，取 `>=` 会连没变的
    读数一起记下来。
    ⚠ bool 走相等比较：开关量的「死区」没有意义，而 bool 是 int 的子类，
    不先挡下来就会掉进数值分支。

    Args: previous, value, deadband。
    """
    if isinstance(previous, bool) or isinstance(value, bool):
        return previous != value
    if isinstance(previous, int | float) and isinstance(value, int | float):
        return abs(float(value) - float(previous)) > deadband
    return previous != value


class AdmissionGate:
    """按策略决定一条读数要不要进归档，并记住每个点位**上一条已归档**的读数。"""

    def __init__(self) -> None:
        self._archived: dict[PointKey, tuple[object, int, Quality]] = {}

    def admit(
        self,
        key: PointKey,
        policy: ArchivePolicy,
        sample: tuple[object, int, Quality],
    ) -> bool:
        """首值 ∨ 心跳到期 ∨ 质量变了 ∨ 超死区 —— 命中任一就收。

        ⚠ 基线是上一条**已归档**的读数，不是上一条见过的读数：拿见过的当
        基线，一条缓慢爬升的曲线可以永远不触发死区而一行都不落库。

        Args: key, policy, sample。
        """
        if not policy.archive_enabled:
            return False
        value, ts_ms, quality = sample
        previous = self._archived.get(key)
        if previous is None or self._is_due(previous, sample, policy):
            self._archived[key] = (value, ts_ms, quality)
            return True
        return False

    def retain(self, keys: frozenset[PointKey]) -> None:
        """只留这些点位的基线，其余丢掉。计划变了时用。

        ⚠ 也是「删掉再加回来」的正确解：基线跟着点位一起走，加回来的点位
        因此重新算首值，而不是被一条几个月前的旧基线挡住。

        Args: keys。
        """
        for key in [key for key in self._archived if key not in keys]:
            del self._archived[key]

    def size(self) -> int:
        """记着基线的点位数。"""
        return len(self._archived)

    @staticmethod
    def _is_due(
        previous: tuple[object, int, Quality],
        sample: tuple[object, int, Quality],
        policy: ArchivePolicy,
    ) -> bool:
        """除首值外的三条准入。

        Args: previous, sample, policy。
        """
        last_value, last_ts_ms, last_quality = previous
        value, ts_ms, quality = sample
        if quality != last_quality:
            return True
        if (
            policy.max_interval_ms > 0
            and ts_ms - last_ts_ms >= policy.max_interval_ms
        ):
            return True
        return is_beyond_deadband(last_value, value, policy.deadband)


@dataclass(frozen=True)
class ArchiveOptions:
    """缓冲的容量与节奏（环境变量给的默认值；计划里的运行参数覆盖它们）。"""

    flush_interval_ms: int
    max_rows: int
    batch_rows: int
    stream_maxlen: int
    # 归档总开关的环境变量默认值。⚠ 关掉之后完全没有报错，只是从此不再归档
    is_enabled: bool = True


class ArchiveBuffer:
    """全部数据源的归档缓冲，加一条定期落 Stream 的循环。"""

    def __init__(
        self, *, stream: ArchiveStream, plan: PlanView, options: ArchiveOptions
    ) -> None:
        """按流、计划面与容量初始化，构造时不起任何任务。

        Args: stream, plan, options。
        """
        self._stream = stream
        self._plan = plan
        self._options = options
        self._interval_s = (
            max(options.flush_interval_ms, MIN_FLUSH_INTERVAL_MS) / 1000
        )
        # ⚠ 有界队列：满了 append 会挤掉最旧的一条。参考实现这里是无界 list，
        # 落库一卡就无限涨——这是它最难查的那类问题
        self._rows: deque[tuple[UUID, ArchiveRow]] = deque(
            maxlen=options.max_rows
        )
        self._gate = AdmissionGate()
        self._policies: dict[PointKey, ArchivePolicy] = {}
        self._plan_version: str | None = None
        self._stopped = asyncio.Event()
        # ⚠ 强引用：事件循环只持有任务的弱引用，丢了引用的任务可能随时消失
        self._task: asyncio.Task[None] | None = None
        self._dropped = 0
        # 其中因缓冲满被挤掉的那部分。两个原因分开记：把写不出去算成「缓冲
        # 满了」，会让人去调上限，而真正的原因是 Redis 不可达
        self._overflowed = 0
        self._reported_overflows = 0

    @property
    def dropped(self) -> int:
        """被挤掉或写不出去而丢掉的行数。静默丢弃最难查，所以要能读出来。"""
        return self._dropped

    @property
    def overflowed(self) -> int:
        """其中因缓冲满被挤掉的行数。"""
        return self._overflowed

    @property
    def pending(self) -> int:
        """此刻缓冲里的行数。"""
        return len(self._rows)

    def sink_for(self, source_id: UUID) -> ValueSink:
        """取一个数据源的归档支线，与快照支线并联挂在同一个 `ValueSink` 上。

        Args: source_id。
        """

        def record(
            point_code: str, value: object, ts_ms: int, quality: Quality
        ) -> None:
            self.record(source_id, point_code, value, ts_ms, quality)

        return record

    def record(
        self,
        source_id: UUID,
        point_code: str,
        value: object,
        ts_ms: int,
        quality: Quality,
    ) -> None:
        """按准入规则收一条读数。

        ⚠ **纯同步、零 await**：它跑在协议库的回调里（COLLECT_DESIGN.md §4.1）。
        也正因为零 await，`_swap()` 不会在换到一半时被打断，不需要锁。

        Args: source_id, point_code, value, ts_ms, quality。
        """
        if not self._enabled_now():
            return
        key = (source_id, point_code)
        policy = self._policies.get(key, DEFAULT_POLICY)
        if not self._gate.admit(key, policy, (value, ts_ms, quality)):
            return
        if len(self._rows) == self._rows.maxlen:
            self._dropped += 1
            self._overflowed += 1
        self._rows.append(
            (
                source_id,
                ArchiveRow(
                    point_code=point_code,
                    value=value,
                    ts_ms=ts_ms,
                    quality=quality,
                ),
            )
        )

    async def start(self) -> None:
        """起 flush 循环。"""
        self._stopped.clear()
        self._refresh_policies()
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        """停循环并把**尾帧**推进流里。

        ⚠ 尾帧不能丢：collector 是链路末端，退出时缓冲里的行没有第二个来源。
        writer 排在本组件之后停，就是为了把这一帧排干（runtime-resilience §8）。
        """
        self._stopped.set()
        task, self._task = self._task, None
        if task is not None:
            await task
        await self.flush_once()

    async def flush_once(self) -> None:
        """把这一窗的行按数据源分组推进各自的流。"""
        self._refresh_policies()
        pending = self._swap()
        for source_id, rows in _by_source(pending):
            await self._append(source_id, rows)
        self._report_overflow()

    def _swap(self) -> list[tuple[UUID, ArchiveRow]]:
        """取走这一窗的全部行，并换上一个空队列。

        容量在这里现取：运行参数把上限改了，下一窗就按新上限走。
        """
        pending = list(self._rows)
        self._rows = deque(maxlen=self._max_rows_now())
        return pending

    def _enabled_now(self) -> bool:
        """此刻归档总开关：计划覆盖值优先，环境变量兜底。"""
        override = tuning.bool_param(
            self._plan.current,
            tuning.SECTION_ARCHIVE,
            tuning.KEY_ARCHIVE_ENABLED,
        )
        return override if override is not None else self._options.is_enabled

    def _max_rows_now(self) -> int:
        """此刻的缓冲行数上限。"""
        override = tuning.int_param(
            self._plan.current,
            tuning.SECTION_ARCHIVE,
            tuning.KEY_BUFFER_MAX_ROWS,
        )
        return override if override is not None else self._options.max_rows

    def _batch_rows_now(self) -> int:
        """此刻的单批行数。"""
        override = tuning.int_param(
            self._plan.current, tuning.SECTION_ARCHIVE, tuning.KEY_BATCH_ROWS
        )
        return override if override is not None else self._options.batch_rows

    def _stream_maxlen_now(self) -> int:
        """此刻的流上限。"""
        override = tuning.int_param(
            self._plan.current,
            tuning.SECTION_ARCHIVE,
            tuning.KEY_STREAM_MAXLEN,
        )
        return override if override is not None else self._options.stream_maxlen

    async def _append(
        self, source_id: UUID, rows: Sequence[ArchiveRow]
    ) -> None:
        """把一个数据源的行按批推进流。

        ⚠ 写失败**绝不许抛回采集热路径**：采集断了是事故，归档断了是降级
        （COLLECT_DESIGN.md §4.3）。
        ⚠ 一批失败就整个数据源不再往下写，且**剩下的批一并计入丢弃**：只数
        当前这批，账面上就会少掉后面那些谁也没写出去的行。
        ⚠ 收的是 `Exception` 不是 `AppError`：Redis 客户端不只抛 RedisError，
        而漏网的那一类会顺着 flush 逃出去带走整条循环——归档就此永久停摆，
        而进程还活着、探针还绿着。

        Args: source_id, rows。
        """
        stream_maxlen = self._stream_maxlen_now()
        batches = list(_batched(rows, self._batch_rows_now()))
        for index, batch in enumerate(batches):
            try:
                length = await self._stream.append(
                    source_id,
                    encode_rows(batch),
                    maxlen=stream_maxlen,
                )
            except Exception as error:
                lost = sum(len(item) for item in batches[index:])
                self._dropped += lost
                _logger.error(
                    "archive_append_failed",
                    "归档缓冲写不进 Redis，本数据源这一窗已丢弃",
                    source_id=str(source_id),
                    dropped=lost,
                    dropped_total=self._dropped,
                    error_type=type(error).__name__,
                )
                return
            self._warn_if_full(source_id, length, maxlen=stream_maxlen)

    def _warn_if_full(
        self, source_id: UUID, length: int, *, maxlen: int
    ) -> None:
        """流顶到上限就等于在丢最旧的历史，必须响亮。

        Args: source_id, length, maxlen。
        """
        if length < maxlen:
            return
        _logger.error(
            "archive_stream_full",
            "归档流已达上限，最旧的条目正在被裁掉，检查落库是否卡住",
            source_id=str(source_id),
            stream_length=length,
            stream_maxlen=maxlen,
        )

    def _report_overflow(self) -> None:
        """这一窗新挤掉了行就报一次，不是每挤掉一行报一次。"""
        if self._overflowed == self._reported_overflows:
            return
        _logger.error(
            "archive_buffer_overflow",
            "归档缓冲超出上限，最旧的行已被挤掉",
            dropped=self._overflowed - self._reported_overflows,
            dropped_total=self._dropped,
            buffer_max=self._max_rows_now(),
        )
        self._reported_overflows = self._overflowed

    def _refresh_policies(self) -> None:
        """计划版本变了才重建索引与基线。没变就是一次比较。"""
        plan = self._plan.current
        if plan is None or plan.version == self._plan_version:
            return
        self._policies = policies_of(plan)
        self._plan_version = plan.version
        self._gate.retain(frozenset(self._policies))

    async def _loop(self) -> None:
        """按周期 flush，直到被叫停。"""
        while not self._stopped.is_set():
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(
                    self._stopped.wait(), timeout=self._interval_s
                )
            await self.flush_once()


def _by_source(
    pending: Sequence[tuple[UUID, ArchiveRow]],
) -> list[tuple[UUID, list[ArchiveRow]]]:
    """按数据源分组，组内保持时间顺序。

    Args: pending。
    """
    grouped: dict[UUID, list[ArchiveRow]] = {}
    for source_id, row in pending:
        grouped.setdefault(source_id, []).append(row)
    return list(grouped.items())


def _batched(
    rows: Sequence[ArchiveRow], size: int
) -> Iterator[Sequence[ArchiveRow]]:
    """按上限切批。

    Args: rows, size。
    """
    for start in range(0, len(rows), size):
        yield rows[start : start + size]


def encode_rows(rows: Sequence[ArchiveRow]) -> list[Mapping[str, object]]:
    """把一批行编成 Stream 载荷。契约测试与 writer 共用这一份。

    Args: rows。
    """
    return [row.to_payload() for row in rows]
