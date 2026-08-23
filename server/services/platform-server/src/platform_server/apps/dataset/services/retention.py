"""保留期夜间清理：worker 角色里的另一条常驻循环，一趟扫完全部配了保留期的台账。

⚠ **「夜间」说的是意图，不是调度器**。这里没有 cron，只有一条带间隔的循环：它
保证的是「两次清理之间至少隔一个周期」，**不保证在哪个墙钟时刻醒来**——进程
什么时候起来，节奏就从什么时候算起。

⚠ 它**真的 DELETE，且不可回滚**。总开关默认关，且危险方向是**开**（与采集开关
恰好相反）。`retention_days` 为空的台账是永久保留，一律跳过。

⚠ **执行锚点由「开关被观察到拨开的那一趟」写下，绝不每一趟推**；真跑过一趟之后
才推进它。开关关着的那些趟反过来把锚点**抹掉**：留着一个一年前的锚点，等于让
「重新拨开开关」在下一次醒来时立刻删光一切，而没有任何一句警告。抹掉它换来的是
——拨开开关之后，总有整整一个周期的反悔余地。

⚠ **必须单活**：worker 有多个副本，不加租约就是每个副本各删各的——删除本身是
幂等的，但压缩块要被反复解压，且 REINDEX 会互相抢排他锁。Redis 不可达一律判
非 leader（runtime-resilience §6.2）。
"""

import asyncio
import contextlib
from contextvars import Token
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Protocol

from lib.logging import (
    LogContext,
    bind_log_context,
    get_logger,
    reset_log_context,
)
from lib.utils.ids import uuid7
from lib.utils.timeutils import format_rfc3339, to_utc, utcnow
from platform_server.apps.dataset.services.collector import (
    Sessions,
    number_or,
)
from platform_server.apps.dataset.services.dirty import DatasetDirtyLog
from platform_server.apps.dataset.services.retention_run import (
    Budget,
    RetentionJob,
    RetentionStats,
    load_jobs,
    reindex_span,
    sweep_table,
)
from platform_server.apps.runtime_params.services import (
    SECTION_DATASET,
    param_service,
)
from platform_server.lease import Lease
from platform_server.settings import Settings

_logger = get_logger("platform.dataset.retention")

# 跨进程契约：清理节奏的执行锚点。⚠ 写死不可配——让它可配等于让两份配置各认一
# 个键，而现象要么是「清理从来不跑」，要么是「拨开开关就当场开删」，两侧都不会
# 报错
ANCHOR_KEY = "platform:dataset:retention:anchor"

# 锚点的存活期。它只是个兜底上限而不是节奏：真正的节奏由清理周期说了算，而周期
# 的上限是 24 小时（运行参数目录钉着），故 30 天怎么都不会先过期。万一真过期
# 了，本趟按「尚未锚定」处理——重新锚定、再等满一个周期，方向是安全的
ANCHOR_TTL_S = 30 * 86_400

# 跨度的一半：trace_id 与 span_id 各取一段十六进制
_TRACE_ID_LENGTH = 32
_SPAN_ID_LENGTH = 16


class AnchorStore(Protocol):
    """执行锚点要用的那三个 Redis 动作。真实现是 `lib.cache.Cache`。

    ⚠ 本模块自己声明这个面而不认整个 `CacheLike`：用到的只有三个方法，窄面让
    用例能拿一个三方法的假件顶上。
    """

    async def get_json(self, key: str) -> Any | None: ...

    async def set_json(self, key: str, value: Any, *, ttl_s: int) -> None: ...

    async def delete(self, key: str) -> None: ...


@dataclass(frozen=True)
class RetentionAnchor:
    """清理节奏的执行锚点：上一次**真的删过**是什么时候。

    落在 Redis 而不是进程内变量，为的是两件事：拨开开关之后仍然要等满一个完整
    周期，以及重启比周期还勤的机器照样轮得到清理。

    ⚠ 读写一律不抛：控制面抖一下不该让清理循环崩掉。读不到就按「尚未锚定」
    处理——那一趟不删、先锚定，这个方向是安全的。
    """

    store: AnchorStore
    key: str = ANCHOR_KEY

    async def read(self) -> datetime | None:
        """上次执行时刻；从未锚定或读不出来都给 None。"""
        try:
            raw = await self.store.get_json(self.key)
        except Exception as error:
            _logger.warning(
                "dataset_retention_anchor_unreadable",
                "读不到执行锚点，本趟按尚未锚定处理",
                error_type=type(error).__name__,
            )
            return None
        return _moment_of(raw)

    async def write(self, moment: datetime) -> None:
        """把锚点写成某一刻。

        ⚠ 失败只记一条：最坏的结果是下一趟重新锚定、多等一个周期，而那正是
        安全的方向。
        Args: moment。
        """
        try:
            await self.store.set_json(
                self.key, format_rfc3339(moment), ttl_s=ANCHOR_TTL_S
            )
        except Exception as error:
            _logger.warning(
                "dataset_retention_anchor_unwritable",
                "执行锚点没写下去，下一趟会重新锚定",
                error_type=type(error).__name__,
            )

    async def clear(self) -> None:
        """抹掉锚点，让下一次拨开开关重新计时。

        ⚠ 这一步是「关着开关的那些趟」唯一要做的事：留着一个陈旧的锚点，等于
        让重新拨开开关在下一次醒来时立刻开删。
        """
        with contextlib.suppress(Exception):
            await self.store.delete(self.key)


@dataclass(frozen=True)
class RetentionContext:
    """清理循环的全部协作者。

    ⚠ `settings` 带进来是因为运行参数的默认值每一趟现取：环境变量是永久默认值
    而不是一次性播种，抄一份进内存等于让「恢复默认」永远回不到真正的默认值。
    """

    database: Sessions
    anchor: RetentionAnchor
    dirty: DatasetDirtyLog
    settings: Settings


@dataclass(frozen=True)
class RetentionKnobs:
    """这一趟的运行参数快照，全部来自 `dataset` 那一组的有效值。"""

    is_enabled: bool
    interval_s: float
    max_rows_per_run: int
    table_timeout_s: float


@dataclass(frozen=True)
class _Sweep:
    """一趟清理的现场：此刻、两个预算与产出账本。

    ⚠ 收成一件而不是六个形参往下传：逐表那一步再多一个参数就顶破 5 个的上限，
    而拆成两次调用会把「预算」与「账本」分到两条路径上各记一半。
    """

    now: datetime
    budget: Budget
    stats: RetentionStats
    table_timeout_s: float


class DatasetRetention:
    """清理循环：持租约 → 读开关 → 对锚点 → 逐表删一段 → 收尾回收索引。"""

    def __init__(self, *, context: RetentionContext, lease: Lease) -> None:
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
        self._interval_s = context.settings.dataset_retention_interval_s

    @property
    def is_leader(self) -> bool:
        """此刻是否持有租约。"""
        return self._is_leader

    async def run(self) -> None:
        """主循环。

        ⚠ 一趟出错不许带走整个循环：带走了就再也不续租约、也不再清理，而进程
        还活着——这是最难察觉的一种停摆。
        """
        while not self._stopped.is_set():
            self._idle.clear()
            try:
                await self.tick()
            except Exception as error:
                _logger.error(
                    "dataset_retention_tick_failed",
                    "保留期清理这一趟出错，下一趟继续",
                    error_type=type(error).__name__,
                )
            finally:
                self._idle.set()
            await self._pause(self._interval_s)

    async def tick(self) -> None:
        """跑一趟：续租约 → 读开关 → 对锚点 → 逐表删。

        ⚠ 每一趟开头换一条 trace：一条几天不停的循环共用一个 trace_id 等于没有
        trace，而 contextvars 不跨任务传播——不绑就取到一串全零。
        """
        token = _bind_tick_trace()
        try:
            if not await self._hold_lease():
                return
            knobs = await self._read_knobs()
            self._interval_s = knobs.interval_s
            now = utcnow()
            if not await self._is_due(knobs, now):
                return
            stats = await self._sweep_all(knobs, now)
            await self._context.anchor.write(now)
            _log_run(stats)
        finally:
            reset_log_context(token)

    def stop(self) -> None:
        """停收新活。⚠ 只置位，不等待——等在 `drain` 里做。"""
        self._stopped.set()

    async def drain(self, timeout_s: float) -> None:
        """等手上这一趟跑完。超时就不等了，让租约那一步照常进行。

        ⚠ 硬停最多让一批过期数据多留一个周期，绝不会留下半张删了一半的表：
        每一批各自提交，批与批之间没有任何需要收尾的状态。
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
        _logger.info("dataset_retention_lease_released", "已让出台账清理租约")

    async def _read_knobs(self) -> RetentionKnobs:
        """取这一趟的运行参数：覆盖行优先，没覆盖的回落到环境变量。"""
        async with self._context.database.session() as session:
            values = await param_service.effective_values(
                session,
                settings=self._context.settings,
                section=SECTION_DATASET,
            )
        return knobs_of(values, self._context.settings)

    async def _is_due(self, knobs: RetentionKnobs, now: datetime) -> bool:
        """这一趟该不该真的删。⚠ 这是唯一挡得住 DELETE 的地方。

        Args: knobs, now。
        """
        anchor = self._context.anchor
        if not knobs.is_enabled:
            # ⚠ 关着的时候把锚点抹掉：留着它，重新拨开开关就会在下一次醒来时
            # 立刻开删——一年没清理过的库会在那一瞬间掉一大片，且毫无预告
            await anchor.clear()
            return False
        period = timedelta(seconds=knobs.interval_s)
        last_run = await anchor.read()
        if last_run is None:
            await anchor.write(now)
            _logger.info(
                "dataset_retention_anchored",
                "保留期清理已锚定，等满一个完整周期之后才第一次删",
                due_at=format_rfc3339(now + period),
            )
            return False
        return now - last_run >= period

    async def _sweep_all(
        self, knobs: RetentionKnobs, now: datetime
    ) -> RetentionStats:
        """把配了保留期的台账各删一段，然后收尾回收索引。

        Args: knobs, now。
        """
        jobs = await load_jobs(self._context.database)
        sweep = _Sweep(
            now=now,
            budget=Budget(knobs.max_rows_per_run),
            stats=RetentionStats(),
            table_timeout_s=knobs.table_timeout_s,
        )
        for job in jobs:
            if self._stopped.is_set() or sweep.budget.is_exhausted:
                break
            sweep.stats.tables += 1
            await self._sweep_one(job, sweep)
            # ⚠ 逐表之间主动让出：这条循环与另外六条共用一个事件循环
            await asyncio.sleep(0)
        sweep.stats.is_capped = sweep.budget.is_exhausted
        await self._reindex(sweep.stats)
        return sweep.stats

    async def _sweep_one(self, job: RetentionJob, sweep: _Sweep) -> None:
        """删一张表的过期行。它自己出错不许打断这一趟里其余的表。

        Args: job, sweep。
        """
        try:
            async with asyncio.timeout(sweep.table_timeout_s):
                result = await sweep_table(
                    self._context.database,
                    job,
                    now=sweep.now,
                    budget=sweep.budget,
                )
        except Exception as error:
            sweep.stats.failed += 1
            _logger.error(
                "dataset_retention_table_failed",
                "这张台账这一趟没删完，下一趟继续",
                table_code=job.code,
                error_type=type(error).__name__,
            )
            return
        sweep.stats.absorb(job, result)
        if result.rows:
            # ⚠ 删行同样会改这张表读出来的东西（长窗口的序列少了一截），
            # 不报脏的表现是大屏静默停在旧数上（§16）
            await self._context.dirty.mark(job.code)

    async def _reindex(self, stats: RetentionStats) -> None:
        """收尾回收压缩块上的死索引页（约束 c）。

        ⚠ **每一趟真删过行就跑一次**，不按运行次数节流：节流计数只活在进程内存
        里，而重启比节流周期还勤的进程会永远轮不到 REINDEX——那是一件不报错、
        只让索引一路涨到 29 倍的事。真正的闸是 chunk 数上限与那几秒的等锁上限：
        拿不到排他锁就跳过，绝不把写入堵死。
        Args: stats。
        """
        span = stats.span()
        if span is None:
            return
        stats.reindexed = await reindex_span(self._context.database, span=span)

    async def _hold_lease(self) -> bool:
        """续或抢租约，返回此刻是不是 leader。

        ⚠ renew-or-die：续不上立刻判非 leader。手上没有任何需要交接的状态——
        每一批各自提交，接任者从锚点往下接着算。
        """
        if self._is_leader:
            if await self._lease.renew():
                return True
            self._is_leader = False
            _logger.error(
                "dataset_retention_lease_lost", "租约续期失败，立刻停止清理"
            )
            return False
        is_acquired = await self._lease.acquire()
        if is_acquired:
            _logger.info(
                "dataset_retention_lease_acquired",
                "接管台账保留期清理，本副本成为 leader",
            )
        self._is_leader = is_acquired
        return is_acquired

    async def _pause(self, delay_s: float) -> None:
        """等到下一趟，被叫停就提前醒。

        Args: delay_s。
        """
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._stopped.wait(), timeout=delay_s)


def knobs_of(
    values: dict[str, bool | int | float], settings: Settings
) -> RetentionKnobs:
    """把 `dataset` 那一组的有效值收敛成这一趟要用的旋钮。

    ⚠ 形状不对时回落到环境变量而不是拿一个 0 去跑：0 的间隔是空转打满一个核，
    而一个悄悄变成 `1` 的开关就是一次没人授权的删除。
    Args: values, settings。
    """
    return RetentionKnobs(
        is_enabled=bool(
            values.get(
                "dataset_retention_enabled",
                settings.dataset_retention_enabled,
            )
        ),
        interval_s=number_or(
            values.get("dataset_retention_interval_s"),
            settings.dataset_retention_interval_s,
        ),
        max_rows_per_run=int(
            number_or(
                values.get("dataset_retention_max_rows_per_run"),
                settings.dataset_retention_max_rows_per_run,
            )
        ),
        table_timeout_s=number_or(
            values.get("dataset_retention_table_timeout_s"),
            settings.dataset_retention_table_timeout_s,
        ),
    )


def _moment_of(raw: Any) -> datetime | None:
    """把锚点的存值收窄成一个 UTC 时刻；形状不对就当尚未锚定。

    ⚠ `Any` 只在这一处：Redis 里的 JSON 出来就是无类型的，立刻收敛。
    Args: raw。
    """
    if not isinstance(raw, str):
        return None
    try:
        moment = datetime.fromisoformat(raw)
    except ValueError:
        _logger.warning(
            "dataset_retention_anchor_unreadable",
            "执行锚点不是合法时刻，本趟按尚未锚定处理",
        )
        return None
    return to_utc(moment)


def _log_run(stats: RetentionStats) -> None:
    """一趟清理的规模落进日志。

    ⚠ 触顶要**明说**：静默截断会让人以为保留期已经完全生效了，而其实每一趟都
    只删掉一部分。
    ⚠ 稳态下每晚删 0 行才是正常的，故什么都没发生的那一趟**不记**——一天一条
    的流水会把真正有内容的那几条埋掉。
    Args: stats。
    """
    if stats.is_capped:
        _logger.warning(
            "dataset_retention_capped",
            "本趟达到单趟实删行数上限，剩下的过期行留到下一趟",
            rows=stats.rows,
            tables=stats.tables,
        )
    if not stats.rows and not stats.failed:
        return
    _logger.info(
        "dataset_retention_run",
        "保留期清理跑完一趟",
        tables=stats.tables,
        rows=stats.rows,
        failed=stats.failed,
        reindexed=stats.reindexed,
        swept=sorted(stats.swept),
    )


def _bind_tick_trace() -> Token[LogContext]:
    """给这一趟绑一条新的 trace，返回还原用的 token。"""
    return bind_log_context(
        trace_id=uuid7().hex[:_TRACE_ID_LENGTH],
        span_id=uuid7().hex[:_SPAN_ID_LENGTH],
        route="dataset_retention.tick",
    )
