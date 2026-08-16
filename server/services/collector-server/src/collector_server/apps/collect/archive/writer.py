"""Stream → TimescaleDB：读一批、写库、**写成功之后**才删。

数据流见 COLLECT_DESIGN.md §4.3 的 ⑦。
⚠ 顺序不可交换：先删后写会在库写失败时丢数据，而反过来最坏只是重投——
重投由归档表的自然主键去重挡掉。
"""

import asyncio
import contextlib
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol
from uuid import UUID

from collector_server.apps.collect import tuning
from collector_server.apps.collect.tuning import PlanView
from collector_server.stream import ArchiveStream, StreamEntry, source_of
from lib.logging import get_logger
from timeseries import normalize_quality, split_value

_logger = get_logger("collect.archive.writer")

MS_PER_S = 1000
# 一次 XRANGE 取多少条目。条目是「一个 flush 窗口的一批行」，取太多会让单轮
# 要装进内存的行数不可预测
ENTRIES_PER_READ = 64
# 一轮 flush 里单条流最多排多少轮，防止一条热流把其余流饿死
MAX_ROUNDS_PER_FLUSH = 50
# flush 周期下限，防止把配置写成 0 之后空转打满 CPU
MIN_FLUSH_INTERVAL_MS = 100


class HistoryStore(Protocol):
    """归档落库面。真实现是 `PointHistoryService`，测试用进程内假件。"""

    async def store(self, rows: Sequence[Mapping[str, Any]]) -> int: ...


@dataclass(frozen=True)
class WriterOptions:
    """落库的节奏。"""

    flush_interval_ms: int


def to_row(
    source_id: UUID, payload: Mapping[str, Any]
) -> dict[str, Any] | None:
    """把 Stream 里的一行编成归档表的一行；形状不对给 None。

    ⚠ 值的两列编码只有 `timeseries.split_value` 一份：写侧与读侧共用它，
    否则「布尔算不算数值」这类问题会在两侧各答一次。

    Args: source_id, payload。
    """
    point_code = payload.get("point_code")
    ts = _as_ts(payload.get("ts_ms"))
    if not isinstance(point_code, str) or not point_code or ts is None:
        return None
    value_num, value_text = split_value(payload.get("value"))
    return {
        "source_id": source_id,
        "point_code": point_code,
        "ts": ts,
        "value_num": value_num,
        "value_text": value_text,
        "quality": normalize_quality(payload.get("quality")),
    }


def _as_ts(value: object) -> datetime | None:
    """把毫秒时刻转成 UTC 时刻；不是整数、或超出日历值域就给 None。

    ⚠ 显式挡掉 bool：它是 int 的子类，`True` 会被当成 1970 年的第 1 毫秒。
    ⚠ 值域也要挡：现场时钟坏掉时回来的毫秒数能落到公元 3 万年，`fromtimestamp`
    在那里抛异常——抛出去这一条就把整条流永久堵死，而堵死的代价是这个数据源
    之后的历史**全部**写不进去。

    Args: value。
    """
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    try:
        return datetime.fromtimestamp(value / MS_PER_S, tz=UTC)
    except (OSError, OverflowError, ValueError):
        return None


class ArchiveWriter:
    """把归档流排干进 TimescaleDB。一个进程一份。"""

    def __init__(
        self,
        *,
        stream: ArchiveStream,
        store: HistoryStore,
        options: WriterOptions,
        plan: PlanView | None = None,
    ) -> None:
        """按流、落库面与节奏初始化，构造时不做 IO。

        `options` 是环境变量给的默认节奏；给了 `plan` 时每一拍先看计划里的
        运行参数覆盖值（即时档：不必重启就生效）。
        Args: stream, store, options, plan。
        """
        self._stream = stream
        self._store = store
        self._flush_interval_ms = options.flush_interval_ms
        self._plan = plan
        self._stopped = asyncio.Event()
        # ⚠ 强引用：事件循环只持有任务的弱引用，丢了引用的任务可能随时消失
        self._task: asyncio.Task[None] | None = None
        self._written = 0
        self._dropped = 0

    @property
    def written(self) -> int:
        """累计落库的行数。"""
        return self._written

    @property
    def dropped(self) -> int:
        """因形状不对被丢弃的行数。静默丢弃最难查，所以要能读出来。"""
        return self._dropped

    async def start(self) -> None:
        """起落库循环。"""
        self._stopped.clear()
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        """停循环并把流里剩下的行排干。

        ⚠ 本组件**最后停**：它要接住 sink 与归档缓冲在关停时补交的尾帧
        （runtime-resilience §8）。
        """
        self._stopped.set()
        task, self._task = self._task, None
        if task is not None:
            await task
        await self.flush_once()

    async def flush_once(self) -> int:
        """把每条流各排一轮，返回本轮落库的行数。

        ⚠ 任何一步失败都只记日志不抛：归档断了是降级，绝不许把采集拖下水
        （COLLECT_DESIGN.md §4.3）。
        """
        try:
            keys = await self._stream.keys()
        except Exception as error:
            _logger.error(
                "archive_keys_failed",
                "列不出归档流，本轮跳过",
                error_type=type(error).__name__,
            )
            return 0
        total = 0
        for key in keys:
            total += await self._drain(key)
        return total

    async def _drain(self, key: str) -> int:
        """把一条流排到空、或排满这一轮的预算为止。

        Args: key。
        """
        source_id = source_of(key)
        if source_id is None:
            return 0
        total = 0
        for _ in range(MAX_ROUNDS_PER_FLUSH):
            written = await self._drain_once(key, source_id)
            total += written
            if written == 0:
                return total
        _logger.warning(
            "archive_drain_budget_spent",
            "归档流一轮没排干，下一拍继续",
            source_id=str(source_id),
            written=total,
        )
        return total

    async def _drain_once(self, key: str, source_id: UUID) -> int:
        """读一批、写库、删条目。返回这一批落库的行数。

        Args: key, source_id。
        """
        try:
            entries = await self._stream.read(key, count=ENTRIES_PER_READ)
            if not entries:
                return 0
            rows = self._decode(source_id, entries)
            await self._store.store(rows)
            # ⚠ 只有走到这里才删：写库失败时条目留在流里，下一轮重来
            await self._stream.delete(
                key, [entry.entry_id for entry in entries]
            )
            self._written += len(rows)
        except Exception as error:
            _logger.error(
                "archive_write_failed",
                "归档落库失败，条目留在流里下一轮重试",
                source_id=str(source_id),
                error_type=type(error).__name__,
            )
            return 0
        return len(rows)

    def _decode(
        self, source_id: UUID, entries: Sequence[StreamEntry]
    ) -> list[dict[str, Any]]:
        """把条目里的行解成库行，形状不对的丢掉并计数。

        ⚠ 丢掉而不是留着：一条解不开的行留在流里会把整条流永久堵死，而堵死
        的代价是这个数据源之后的历史**全部**写不进去。

        Args: source_id, entries。
        """
        rows: list[dict[str, Any]] = []
        broken = 0
        for entry in entries:
            for payload in entry.rows:
                row = to_row(source_id, payload)
                if row is None:
                    broken += 1
                    continue
                rows.append(row)
        if broken:
            self._report_broken(source_id, broken)
        return rows

    def _report_broken(self, source_id: UUID, broken: int) -> None:
        """把丢掉的行数报出来。

        Args: source_id, broken。
        """
        self._dropped += broken
        _logger.error(
            "archive_row_undecodable",
            "归档行形状不对，已丢弃",
            source_id=str(source_id),
            dropped=broken,
            dropped_total=self._dropped,
        )

    def _interval_s_now(self) -> float:
        """此刻的落库周期：计划覆盖值优先，环境变量兜底。"""
        override = tuning.int_param(
            None if self._plan is None else self._plan.current,
            tuning.SECTION_ARCHIVE,
            tuning.KEY_WRITER_FLUSH_MS,
        )
        interval_ms = (
            override if override is not None else self._flush_interval_ms
        )
        return max(interval_ms, MIN_FLUSH_INTERVAL_MS) / 1000

    async def _loop(self) -> None:
        """按周期排流，直到被叫停。"""
        while not self._stopped.is_set():
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(
                    self._stopped.wait(), timeout=self._interval_s_now()
                )
            await self.flush_once()
