"""历史回填的计划：对齐桶网格、三道 clamp、切批。**零 IO 的纯函数**。

回填与向前采集共用同一套桶网格与同一个行标识构造式（`services/buckets.py`）
——两份「桶怎么算」的实现是这块地方唯一真正的风险：数值都合法、两侧各写各的
行，没有任何一处会报错（docs/DATASET_DESIGN.md §14）。

⚠ **三道 clamp 一律留下一条中文说明**：静默裁剪的表现是「我要了一年，它补了
一个月」，而界面上看不出少了哪一段。
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

from lib.utils.timeutils import format_rfc3339
from platform_server.apps.dataset.errors import DatasetBackfillInvalid
from platform_server.apps.dataset.models import DatasetTable
from platform_server.apps.dataset.services.aggregate import BucketWindow
from platform_server.apps.dataset.services.buckets import (
    bucket_interval,
    bucket_sequence,
    bucket_start,
    shift_bucket,
)
from platform_server.apps.dataset.services.record_compute import (
    MAX_RECOMPUTE_ROWS,
)

# 一批算多少个桶 = 一次聚合 = 一次 upsert = 一个事务（§14）。
# ⚠ 它同时是取消的粒度：取消只在批边界生效，绝不留下写了一半的批
BATCH_BUCKETS = 240
# 单次回填的桶数上限，与一次重算能改写的行数对齐——补出来的行紧接着就要重算，
# 两个上限不一致的话，多出来的那一截会写出行却永远没有公式值
MAX_BACKFILL_BUCKETS = MAX_RECOMPUTE_ROWS
# 取数路径。⚠ 本仓的点位历史**没有**连续聚合视图，故恒为原始表；回执里如实说
# 出来，而不是留一个永远填不上的「快路」字段
RAW_PATH = "raw"
# 回填的右界比采集器下一拍的起点再退一格：那一格是「采集器还会写的第一个桶」
# 本身，让出去两边才真的不相交。
# ⚠ 只退一格就够，不必按整段时长再留余量：`now` 往前走时采集器的起点只会跟着
# 往后挪，算出来的这个界此后一直安全
_GUARD_GAP = 1


@dataclass(frozen=True)
class PlanLimits:
    """三道 clamp 的口径与桶网格的时区。

    ⚠ `timezone` 只能是 `PLATFORM_DATASET_BUCKET_TIMEZONE`：它同时喂 SQL 的
    `time_bucket` 与 Python 的 `bucket_start`，两边分家就是静默写歪（§4.5.1）。
    """

    timezone: str
    #: 点位历史还留得住多少天。`None` = 这张表绑的点位都是永久保留，没有下界
    retention_days: int | None
    #: 采集器每拍额外重算最近几个已关闭的桶（D6），取的是**运行参数有效值**
    recompute_tail_buckets: int
    max_buckets: int = MAX_BACKFILL_BUCKETS


@dataclass(frozen=True)
class BackfillBatch:
    """一批要补的桶，两端都是桶起点、闭区间。"""

    first: datetime
    last: datetime
    count: int


@dataclass(frozen=True)
class BackfillPlan:
    """一次回填补哪一段、共几个桶、被裁掉了什么。"""

    first: datetime
    last: datetime
    interval: timedelta
    timezone: str
    total_buckets: int
    is_clamped: bool
    notes: tuple[str, ...]


@dataclass(frozen=True)
class BucketGrid:
    """桶网格：把 `services/buckets.py` 那三个函数收成一件。

    省掉逐处传「桶宽 + 时区」这一对，两者在这条链路上从来是一起走的。
    """

    interval: timedelta
    timezone: str

    def align(self, moment: datetime) -> datetime:
        """这一刻落在哪个桶里。

        Args: moment。
        """
        return bucket_start(
            moment, interval=self.interval, timezone=self.timezone
        )

    def shift(self, bucket: datetime, steps: int) -> datetime:
        """往前或往后数 `steps` 个桶。

        Args: bucket, steps。
        """
        return shift_bucket(
            bucket, steps=steps, interval=self.interval, timezone=self.timezone
        )

    def sequence(self, first: datetime, last: datetime) -> tuple[datetime, ...]:
        """闭区间里的全部桶起点，升序。

        Args: first, last。
        """
        return bucket_sequence(
            first, last, interval=self.interval, timezone=self.timezone
        )


def grid_of(table: DatasetTable, timezone: str) -> BucketGrid:
    """一张台账的桶网格。

    Args: table, timezone。
    """
    return BucketGrid(
        interval=bucket_interval(table.collect_interval_ms), timezone=timezone
    )


def plan_backfill(
    table: DatasetTable,
    *,
    since: datetime,
    until: datetime,
    now: datetime,
    limits: PlanLimits,
) -> BackfillPlan:
    """把请求的区间对齐到桶网格并做完三道 clamp；一个桶都不剩就抛。

    Args: table, since, until, now, limits。
    """
    # ⚠ 区间是**桶闭区间**：两端各自落到自己那个桶上，两端同桶就是「只补这
    # 一个桶」。要求 `until` 严格晚于 `since` 的话，想补一个桶的人得写出
    # 「桶起点 + 1 毫秒」，而写错一位就静默变成补两个桶
    if until < since:
        raise DatasetBackfillInvalid("结束时间不能早于开始时间")
    grid = grid_of(table, limits.timezone)
    notes: list[str] = []
    first = grid.align(since)
    last = grid.align(until)
    floor = retention_floor(grid, now=now, retention_days=limits.retention_days)
    if floor is not None and first < floor:
        notes.append(_floor_note(floor, limits.retention_days))
        first = floor
    guard = guard_bucket(
        grid, table, now=now, tail=limits.recompute_tail_buckets
    )
    if last > guard:
        notes.append(_guard_note(guard))
        last = guard
    if last < first:
        raise DatasetBackfillInvalid(
            "所选区间里没有可回填的桶——整段要么早于点位历史的保留期，"
            "要么落在向前采集器仍会重写的那一截上"
        )
    total = count_buckets(grid, first, last, ceiling=limits.max_buckets)
    if total > limits.max_buckets:
        first = grid.shift(last, -(limits.max_buckets - 1))
        total = limits.max_buckets
        notes.append(_count_note(first, limits.max_buckets))
    return _plan_of(grid, (first, last), total, notes)


def _plan_of(
    grid: BucketGrid,
    span: tuple[datetime, datetime],
    total: int,
    notes: list[str],
) -> BackfillPlan:
    """拼出计划本身，并在末尾补一条「走的是哪条取数路径」。

    ⚠ `is_clamped` 在补这一条**之前**定：取数路径不是裁剪，混进去会让每一次
    回填都自称被裁过，而界面据此常亮一个警告——警告常亮等于没有警告。
    Args: grid, span（首末桶）, total, notes。
    """
    first, last = span
    is_clamped = bool(notes)
    notes.append(
        "取数走点位历史原始表：本仓没有 1 小时连续聚合视图，"
        "区间越长越慢，建议分段回填"
    )
    return BackfillPlan(
        first=first,
        last=last,
        interval=grid.interval,
        timezone=grid.timezone,
        total_buckets=total,
        is_clamped=is_clamped,
        notes=tuple(notes),
    )


def retention_floor(
    grid: BucketGrid, *, now: datetime, retention_days: int | None
) -> datetime | None:
    """能回填到的最早那个桶；没有保留期下界时给 None。

    ⚠ **向上取整**：跨在保留期边界上的那个桶只剩半桶样本，折算出来是一个错的
    数，而它一旦写出去就永久留在台账里，与一个真实的低值长得一模一样（§2.4）。
    Args: grid, now, retention_days。
    """
    if retention_days is None:
        return None
    floor = now - timedelta(days=retention_days)
    aligned = grid.align(floor)
    return aligned if aligned == floor else grid.shift(aligned, 1)


def guard_bucket(
    grid: BucketGrid, table: DatasetTable, *, now: datetime, tail: int
) -> datetime:
    """回填的右界：最后一个向前采集器不会再回头写的桶。

    ⚠ 采集器下一拍从**水位**往下算，不是从最后一个已关闭的桶：开关关了很久的
    表水位停在原地，它的射程于是整段压在过去——按「最近几个桶」让位会让两边
    同时写同一批行（§12.3）。
    ⚠ 只按台账自己的两项判，不看采集总开关：那个开关随时会被打开，而回填这时
    已经跑在半路上了。
    Args: grid, table, now, tail。
    """
    last_closed = grid.shift(grid.align(now), -1)
    if table.collect_mode != "aggregate" or not table.is_enabled:
        return last_closed
    reach = min(last_closed, _collector_first(grid, table, now=now, tail=tail))
    return grid.shift(reach, -_GUARD_GAP)


def count_buckets(
    grid: BucketGrid, first: datetime, last: datetime, *, ceiling: int
) -> int:
    """闭区间里有多少个桶；数过 `ceiling` 就不再往下数。

    ⚠ 按批跨步数而不是逐桶走：一次最多 20 万个桶，逐桶展开只为了数个数，那一
    串在算出上限之前就已经占住内存了。只有最后一批要真的展开——前面每一批按
    构造恰好是满的。
    Args: grid, first, last, ceiling。
    """
    total = 0
    cursor = first
    while cursor <= last:
        edge = grid.shift(cursor, BATCH_BUCKETS - 1)
        if edge > last:
            return total + len(grid.sequence(cursor, last))
        total += BATCH_BUCKETS
        if total > ceiling:
            return total
        cursor = grid.shift(edge, 1)
    return total


def slice_batches(plan: BackfillPlan) -> tuple[BackfillBatch, ...]:
    """把整段切成一批批，每批 `BATCH_BUCKETS` 个桶。

    Args: plan。
    """
    grid = BucketGrid(interval=plan.interval, timezone=plan.timezone)
    found: list[BackfillBatch] = []
    cursor = plan.first
    while cursor <= plan.last:
        edge = grid.shift(cursor, BATCH_BUCKETS - 1)
        last = min(plan.last, edge)
        count = (
            BATCH_BUCKETS
            if edge <= plan.last
            else len(grid.sequence(cursor, last))
        )
        found.append(BackfillBatch(first=cursor, last=last, count=count))
        cursor = grid.shift(last, 1)
    return tuple(found)


def batch_window(plan: BackfillPlan, batch: BackfillBatch) -> BucketWindow:
    """一批桶交给聚合层时的形状。

    Args: plan, batch。
    """
    grid = BucketGrid(interval=plan.interval, timezone=plan.timezone)
    return BucketWindow(
        starts=grid.sequence(batch.first, batch.last),
        interval=plan.interval,
        timezone=plan.timezone,
    )


def _collector_first(
    grid: BucketGrid, table: DatasetTable, *, now: datetime, tail: int
) -> datetime:
    """采集器下一拍从哪个桶开始写，口径与 `collect_run._first_bucket` 逐字相同。

    Args: grid, table, now, tail。
    """
    watermark = table.last_collected_ts
    if watermark is None:
        return grid.shift(grid.align(now), -1)
    return grid.shift(grid.align(watermark), 1 - tail)


def _floor_note(floor: datetime, retention_days: int | None) -> str:
    """起点被保留期顶上去时的那句话。

    Args: floor, retention_days。
    """
    return (
        f"起点早于点位历史的保留期（{retention_days} 天），已上移到 "
        f"{format_rfc3339(floor)}：更早的原始样本已被清理，重算只会得到空行。"
        "⚠ 边界那个桶是**向上**取整的——半桶样本折算出来是个错的数"
    )


def _guard_note(guard: datetime) -> str:
    """终点被采集器射程压下来时的那句话。

    Args: guard。
    """
    return (
        f"终点已下移到 {format_rfc3339(guard)}：再往后的桶仍归向前采集器写，"
        "两边同时写同一行只会互相覆盖。那一段不必回填——采集器会自己算到"
    )


def _count_note(first: datetime, max_buckets: int) -> str:
    """桶数触顶时的那句话。

    Args: first, max_buckets。
    """
    return (
        f"单次回填最多 {max_buckets} 个桶，起点已下移到 "
        f"{format_rfc3339(first)}：留下的是**较新**的那一段，"
        "更早的区间请再发一次回填"
    )
