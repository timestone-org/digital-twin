"""台账聚合采集器：worker 角色里的一条常驻循环，一拍扫完全部台账。

**必须单活**：worker 有多个副本，不加租约就是每个副本每拍各算一遍同一批桶。
写入本身是幂等的（D2），但两个副本会互相把对方刚算的结果原地覆盖一遍，白烧
一份数据库负载。⚠ Redis 不可达一律判非 leader（runtime-resilience §6.2）。

⚠ **一条循环管全部台账**，不是一张表一条循环：台账是几十张级别的低频派生层，
每张一条循环等于几十个各自持租约、各自定时的独立单元，而它们共用同一个事件
循环与同一个连接池。逐表的隔离靠「一表一事务、一表一超时」拿到（§12）。

⚠ 总开关在**每一拍**里读，不是启动时读一次：运维在界面上一关，下一拍就停，
不必重启进程。口径见 docs/DATASET_DESIGN.md §13。
"""

import asyncio
import contextlib
import uuid
from collections.abc import Sequence
from contextlib import AbstractAsyncContextManager
from contextvars import Token
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import (
    LogContext,
    bind_log_context,
    get_logger,
    reset_log_context,
)
from lib.utils.ids import uuid7
from lib.utils.timeutils import utcnow
from platform_server.apps.dataset.crud import table_crud
from platform_server.apps.dataset.services.aggregate import HistoryReader
from platform_server.apps.dataset.services.collect_run import (
    RunContext,
    RunLimits,
    RunOutcome,
    collect_table,
)
from platform_server.apps.dataset.services.dirty import DatasetDirtyLog
from platform_server.apps.runtime_params.services import (
    SECTION_DATASET,
    param_service,
)
from platform_server.lease import Lease
from platform_server.settings import Settings

_logger = get_logger("platform.dataset.collector")

# 跨度的一半：trace_id 与 span_id 各取一段十六进制
_TRACE_ID_LENGTH = 32
_SPAN_ID_LENGTH = 16


class Sessions(Protocol):
    """开一个短事务的最小面。

    ⚠ 只认这一个方法而不认 `Database`：一拍里要开「读开关」「列表」与逐表各
    一个互不相干的短事务，把它收成一个面，用例才能把那条回滚事务包进来，而不
    必让被测代码知道自己跑在用例里。
    """

    def session(self) -> AbstractAsyncContextManager[AsyncSession]: ...


@dataclass(frozen=True)
class CollectorContext:
    """采集循环的全部协作者。

    ⚠ `settings` 带进来是因为运行参数的默认值每一拍现取：环境变量是永久默认值
    而不是一次性播种，抄一份进内存等于让「恢复默认」永远回不到真正的默认值。
    """

    database: Sessions
    history: HistoryReader
    dirty: DatasetDirtyLog
    settings: Settings


@dataclass(frozen=True)
class CollectorKnobs:
    """这一拍的运行参数快照，全部来自 `dataset` 那一组的有效值。"""

    is_enabled: bool
    interval_s: float
    table_timeout_s: float
    limits: RunLimits


class DatasetCollector:
    """采集循环：持租约 → 读开关 → 逐表算一段 → 推水位。"""

    def __init__(self, *, context: CollectorContext, lease: Lease) -> None:
        """按依赖初始化，构造时不做 IO。

        Args: context, lease。
        """
        self._context = context
        self._lease = lease
        self._stopped = asyncio.Event()
        self._idle = asyncio.Event()
        self._idle.set()
        self._is_leader = False
        # 读不到运行参数时按环境变量给的节奏走，而不是原地空转
        self._interval_s = context.settings.dataset_interval_s

    @property
    def is_leader(self) -> bool:
        """此刻是否持有租约。"""
        return self._is_leader

    async def run(self) -> None:
        """主循环。

        ⚠ 一拍出错不许带走整个循环：带走了就再也不续租约、也不再采集，而进程
        还活着——这是最难察觉的一种停摆。
        """
        while not self._stopped.is_set():
            self._idle.clear()
            try:
                await self.tick()
            except Exception as error:
                _logger.error(
                    "dataset_collect_tick_failed",
                    "台账采集这一拍出错，下一拍继续",
                    error_type=type(error).__name__,
                )
            finally:
                self._idle.set()
            await self._pause(self._interval_s)

    async def tick(self) -> None:
        """跑一拍：续租约 → 读开关 → 逐表算。

        ⚠ 每一拍开头换一条 trace：一条几天不停的循环共用一个 trace_id 等于没有
        trace，而 contextvars 不跨任务传播——不绑就取到一串全零。
        """
        token = _bind_tick_trace()
        try:
            if not await self._hold_lease():
                return
            knobs = await self._read_knobs()
            self._interval_s = knobs.interval_s
            if not knobs.is_enabled:
                return
            await self._collect_all(knobs)
        finally:
            reset_log_context(token)

    def stop(self) -> None:
        """停收新活。⚠ 只置位，不等待——等在 `drain` 里做。"""
        self._stopped.set()

    async def drain(self, timeout_s: float) -> None:
        """等手上这一拍跑完。超时就不等了，让租约那一步照常进行。

        Args: timeout_s。
        """
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._idle.wait(), timeout=timeout_s)

    async def release(self) -> None:
        """让租约。持有才让，且让完就不再是 leader。"""
        if not self._is_leader:
            return
        self._is_leader = False
        await self._lease.release()
        _logger.info("dataset_collect_lease_released", "已让出台账采集租约")

    async def _read_knobs(self) -> CollectorKnobs:
        """取这一拍的运行参数：覆盖行优先，没覆盖的回落到环境变量。"""
        async with self._context.database.session() as session:
            values = await param_service.effective_values(
                session,
                settings=self._context.settings,
                section=SECTION_DATASET,
            )
        return knobs_of(values, self._context.settings)

    async def _collect_all(self, knobs: CollectorKnobs) -> None:
        """把全部按周期聚合的台账各算一段。

        Args: knobs。
        """
        async with self._context.database.session() as session:
            table_ids = await table_crud.aggregating_ids(session)
        now = utcnow()
        outcomes: list[RunOutcome] = []
        for table_id in table_ids:
            if self._stopped.is_set():
                break
            outcome = await self._collect_one(table_id, knobs, now)
            if outcome is not None:
                outcomes.append(outcome)
            # ⚠ 逐表之间主动让出：这条循环与另外五条消费循环共用一个事件循环，
            # 几十张表连着算会把同进程的 /health 一起卡住
            await asyncio.sleep(0)
        _log_tick(outcomes)

    async def _collect_one(
        self, table_id: uuid.UUID, knobs: CollectorKnobs, now: datetime
    ) -> RunOutcome | None:
        """算一张表。它自己出错不许打断这一拍里其余的表。

        ⚠ 一表一事务：整拍共用一个事务的话，一张表撞上约束就会把同一拍里已经
        算好的其余表一起回滚掉。
        Args: table_id, knobs, now。
        """
        try:
            async with asyncio.timeout(knobs.table_timeout_s):
                async with self._context.database.session() as session:
                    return await collect_table(
                        session,
                        self._run_context(),
                        table_id=table_id,
                        now=now,
                        limits=knobs.limits,
                    )
        except Exception as error:
            _logger.error(
                "dataset_collect_table_failed",
                "这张台账这一拍没算完，下一拍继续",
                table_id=str(table_id),
                error_type=type(error).__name__,
            )
            return None

    def _run_context(self) -> RunContext:
        """逐表采集要用的协作者与桶时区。

        ⚠ 时区取 `dataset` 那一个而不是采集面那一个：两者配得不一样时，SQL 按
        一种边界分桶、Python 按另一种算水位，行会成批落进隔壁那一格（§4.5.1）。
        """
        return RunContext(
            history=self._context.history,
            dirty=self._context.dirty,
            timezone=self._context.settings.dataset_bucket_timezone,
        )

    async def _hold_lease(self) -> bool:
        """续或抢租约，返回此刻是不是 leader。

        ⚠ renew-or-die：续不上立刻判非 leader。接任者从水位往下接着算，手上没有
        任何需要交接的状态——写入是按桶身份幂等的。
        """
        if self._is_leader:
            if await self._lease.renew():
                return True
            self._is_leader = False
            _logger.error(
                "dataset_collect_lease_lost", "租约续期失败，立刻停止采集"
            )
            return False
        is_acquired = await self._lease.acquire()
        if is_acquired:
            _logger.info(
                "dataset_collect_lease_acquired",
                "接管台账采集，本副本成为 leader",
            )
        self._is_leader = is_acquired
        return is_acquired

    async def _pause(self, delay_s: float) -> None:
        """等到下一拍，被叫停就提前醒。

        Args: delay_s。
        """
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._stopped.wait(), timeout=delay_s)


def knobs_of(
    values: dict[str, bool | int | float], settings: Settings
) -> CollectorKnobs:
    """把 `dataset` 那一组的有效值收敛成这一拍要用的旋钮。

    ⚠ 形状不对时回落到环境变量而不是拿一个 0 去跑：0 的间隔是空转打满一个核。
    Args: values, settings。
    """
    return CollectorKnobs(
        is_enabled=bool(
            values.get("dataset_enabled", settings.dataset_enabled)
        ),
        interval_s=number_or(
            values.get("dataset_interval_s"), settings.dataset_interval_s
        ),
        table_timeout_s=number_or(
            values.get("dataset_table_timeout_s"),
            settings.dataset_table_timeout_s,
        ),
        limits=RunLimits(
            recompute_tail_buckets=int(
                number_or(
                    values.get("dataset_recompute_tail_buckets"),
                    settings.dataset_recompute_tail_buckets,
                )
            ),
            max_buckets_per_tick=int(
                number_or(
                    values.get("dataset_max_buckets_per_tick"),
                    settings.dataset_max_buckets_per_tick,
                )
            ),
        ),
    )


def number_or(raw: object, fallback: float) -> float:
    """把一个运行参数收窄成数；不是数就回落。保留期清理那条循环共用它。

    ⚠ 布尔要单独挡掉：它在 Python 里是 int 的子类，不挡就会有一个 True 悄悄
    变成 1 秒的间隔。
    Args: raw, fallback。
    """
    if isinstance(raw, bool) or not isinstance(raw, int | float):
        return fallback
    return raw


def _log_tick(outcomes: Sequence[RunOutcome]) -> None:
    """一拍的规模落进日志。

    ⚠ 无事发生的一拍**不记**：一分钟一条的流水会把真正有内容的那几条埋掉。
    Args: outcomes。
    """
    rows = sum(outcome.written for outcome in outcomes)
    awaiting = [
        outcome.table_code
        for outcome in outcomes
        if outcome.is_awaiting_columns
    ]
    if not rows and not awaiting:
        return
    _logger.info(
        "dataset_collect_tick",
        "台账采集这一拍算完了",
        tables=len(outcomes),
        rows=rows,
        # ⚠ 一根点位列都没绑的表水位原地不动，等配好之后从原地接着算
        awaiting_columns=sorted(awaiting),
    )


def _bind_tick_trace() -> Token[LogContext]:
    """给这一拍绑一条新的 trace，返回还原用的 token。"""
    return bind_log_context(
        trace_id=uuid7().hex[:_TRACE_ID_LENGTH],
        span_id=uuid7().hex[:_SPAN_ID_LENGTH],
        route="dataset_collect.tick",
    )
