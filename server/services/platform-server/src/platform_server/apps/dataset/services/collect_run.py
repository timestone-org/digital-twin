"""一张台账在一拍里的采集：定桶 → 折算 → 幂等写 → 重算 → 推水位 → 报脏。

调度那一层在 `services/collector.py`；这里只管**一张表、一个事务**里发生的事，
故一张表出问题不会带走同一拍里其余的表（§12）。
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import get_logger
from platform_server.apps.dataset.crud import (
    CollectedRow,
    RecordWindow,
    column_crud,
    record_crud,
    table_crud,
)
from platform_server.apps.dataset.models import DatasetColumn, DatasetTable
from platform_server.apps.dataset.services.aggregate import (
    BucketWindow,
    Cell,
    HistoryReader,
    PointColumn,
    aggregate_cells,
)
from platform_server.apps.dataset.services.buckets import (
    bucket_interval,
    bucket_sequence,
    bucket_start,
    collected_row_id,
    shift_bucket,
)
from platform_server.apps.dataset.services.dirty import (
    DatasetDirtyLog,
    mark_dirty,
)
from platform_server.apps.dataset.services.record_compute import (
    build_scope,
    recompute_range,
)
from timeseries import InvalidNodeKey, split_node_key

_logger = get_logger("platform.dataset.collect")

# 三档列来源，取值集合见 `protocols.ColumnSource`
POINT_SOURCE = "point"
MANUAL_SOURCE = "manual"
FORMULA_SOURCE = "formula"


@dataclass(frozen=True)
class RunContext:
    """一次采集要用的协作者与口径。

    ⚠ `timezone` 同时喂给 SQL 的 `time_bucket` 与 Python 的 `bucket_start`，
    只能是 `PLATFORM_DATASET_BUCKET_TIMEZONE` 那一个（§4.5.1）。
    """

    history: HistoryReader
    dirty: DatasetDirtyLog
    timezone: str


@dataclass(frozen=True)
class RunLimits:
    """一拍里单表的两个上限。"""

    #: 每拍额外重算最近这么多个**已关闭**的桶，兜住迟到数据（D6）
    recompute_tail_buckets: int
    #: 一拍最多算多少个桶。停机很久之后靠一拍一段往前追，而不是一次扫回全部
    max_buckets_per_tick: int


@dataclass(frozen=True)
class RunOutcome:
    """一张表这一拍的结论。"""

    table_code: str
    buckets: int
    written: int
    watermark: datetime | None
    #: 一根点位列都没绑，这一拍连水位都不推
    is_awaiting_columns: bool


async def collect_table(
    session: AsyncSession,
    context: RunContext,
    *,
    table_id: uuid.UUID,
    now: datetime,
    limits: RunLimits,
) -> RunOutcome | None:
    """把一张台账算到最后一个已关闭的桶为止；表已不在给 None。

    Args: session, context, table_id, now, limits。
    """
    table = await table_crud.get(session, table_id)
    if table is None:
        return None
    columns = await column_crud.list_by_table(session, table.id)
    points = _point_columns(table, columns)
    if not points:
        # ⚠ 水位一格都不推：等有人把点位列配上之后要能从原地接着算。推了就是把
        # 这段时间**永久跳过**——它此后只能靠回填补，而回填要人显式触发
        return _awaiting(table)
    window = _window_of(
        table, now=now, timezone=context.timezone, limits=limits
    )
    if window is None:
        return _awaiting(table, is_awaiting_columns=False)
    written = await _write_window(
        session, context, table, (columns, points, window)
    )
    table.last_collected_ts = window.starts[-1]
    return RunOutcome(
        table_code=table.code,
        buckets=len(window.starts),
        written=written,
        watermark=window.starts[-1],
        is_awaiting_columns=False,
    )


async def _write_window(
    session: AsyncSession,
    context: RunContext,
    table: DatasetTable,
    scope: tuple[list[DatasetColumn], list[PointColumn], BucketWindow],
) -> int:
    """折算这段桶序列并落库，回写出的行数。

    ⚠ 打包传 `scope` 不是为了好看：形参上限是 5，而这一步天然要会话、协作者、
    表、列定义、点位列与桶序列六件。
    Args: session, context, table, scope（列定义 / 点位列 / 桶序列）。
    """
    columns, points, window = scope
    cells = await aggregate_cells(
        context.history, columns=points, window=window
    )
    rows = _rows_of(table.id, cells, _manual_defaults(columns))
    if not rows:
        return 0
    await record_crud.upsert_collected(
        session,
        table_id=table.id,
        rows=rows,
        manual_keys=[
            column.key for column in columns if column.source != POINT_SOURCE
        ],
    )
    await _recompute(session, context, table, columns, window)
    mark_dirty(session, context.dirty, table.code)
    return len(rows)


async def _recompute(
    session: AsyncSession,
    context: RunContext,
    table: DatasetTable,
    columns: list[DatasetColumn],
    window: BucketWindow,
) -> None:
    """重算刚写过的那一段的公式列。

    ⚠ 不重算的话，表格会同时显示「这一拍新采的原始值」与「按上一拍的值算出来
    的公式值」，而两者都不带任何标记。
    ⚠ 先看有没有公式列再编计划：编一次计划要额外问两趟库（全部台账编码与
    `{编码: id}`），一张没有公式列的表每一拍白问两趟。
    Args: session, context, table, columns, window。
    """
    if not any(column.source == FORMULA_SOURCE for column in columns):
        return
    plan = await build_scope(
        session, columns=columns, timezone=ZoneInfo(context.timezone)
    )
    if plan.plan.is_empty:
        return
    await recompute_range(
        session,
        plan,
        table_id=table.id,
        window=RecordWindow(
            table_id=table.id,
            since=window.starts[0],
            until=window.starts[-1],
        ),
    )


def _point_columns(
    table: DatasetTable, columns: list[DatasetColumn]
) -> list[PointColumn]:
    """能真正参与聚合的点位列。绑定串写坏的那几列跳过并记一条。

    ⚠ 跳过而不是抛：它跑在 leader 的后台 loop 里，一列配坏不该让整张表的采集
    从此停住（§4.4）。
    Args: table, columns。
    """
    found: list[PointColumn] = []
    for column in columns:
        if column.source != POINT_SOURCE or not column.node_key:
            continue
        parsed = _parse_node_key(table, column)
        if parsed is not None:
            found.append(parsed)
    return found


def _parse_node_key(
    table: DatasetTable, column: DatasetColumn
) -> PointColumn | None:
    """把列上的 `node_key` 拆成点位身份；拆不开给 None。

    Args: table, column。
    """
    node_key = column.node_key or ""
    try:
        source_id, point_code = split_node_key(node_key)
    except InvalidNodeKey:
        _logger.warning(
            "dataset_collect_node_key_unusable",
            "这一列绑的点位身份不合法，本拍跳过它",
            table_code=table.code,
            column_key=column.key,
        )
        return None
    return PointColumn(
        key=column.key,
        node_key=node_key,
        agg=column.agg,
        source_id=source_id,
        point_code=point_code,
    )


def _manual_defaults(columns: list[DatasetColumn]) -> dict[str, Any]:
    """人工录入列的表单默认值。

    ⚠ 只给**新建**的行用：更新时这些键会从 EXCLUDED 里被减掉，否则每一拍都拿
    默认值盖掉人填的数（`record_crud.upsert_collected`）。
    Args: columns。
    """
    return {
        column.key: column.default_value
        for column in columns
        if column.source == MANUAL_SOURCE and column.default_value is not None
    }


def _rows_of(
    table_id: uuid.UUID,
    cells: dict[datetime, dict[str, Cell]],
    defaults: dict[str, Any],
) -> list[CollectedRow]:
    """把折算结果摊成待写的行，按桶升序。

    ⚠ 整行全空的桶**不写行**（D3）：一格都算不出来的桶写出去就是一行永远解释
    不清的空记录，而它在图上与一个真实的零点长得一模一样。
    Args: table_id, cells, defaults。
    """
    rows: list[CollectedRow] = []
    for bucket in sorted(cells):
        found = cells[bucket]
        if all(cell.value is None for cell in found.values()):
            continue
        rows.append(
            CollectedRow(
                ts=bucket,
                row_id=collected_row_id(table_id, bucket),
                values={
                    **defaults,
                    **{key: cell.value for key, cell in found.items()},
                },
                samples={key: cell.samples for key, cell in found.items()},
            )
        )
    return rows


def _window_of(
    table: DatasetTable,
    *,
    now: datetime,
    timezone: str,
    limits: RunLimits,
) -> BucketWindow | None:
    """这一拍该算哪几个桶；一个都轮不到给 None。

    ⚠ 只算**已经关闭**的桶：当前这个桶还在收数，此刻折算出来的是半截的数，
    而它会被下一拍原地改掉——图上表现为最后一格反复跳。
    Args: table, now, timezone, limits。
    """
    interval = bucket_interval(table.collect_interval_ms)
    current = bucket_start(now, interval=interval, timezone=timezone)
    last_closed = shift_bucket(
        current, steps=-1, interval=interval, timezone=timezone
    )
    first = _first_bucket(
        table, last_closed, interval=interval, timezone=timezone, limits=limits
    )
    if first > last_closed:
        return None
    # ⚠ 先把右界压到上限之内再展开：停机一个月的 1 秒表展开出来是几百万个桶，
    # 而那一串在算出上限之前就已经把内存吃掉了
    reachable = shift_bucket(
        first,
        steps=limits.max_buckets_per_tick - 1,
        interval=interval,
        timezone=timezone,
    )
    starts = bucket_sequence(
        first,
        min(last_closed, reachable),
        interval=interval,
        timezone=timezone,
    )
    return BucketWindow(starts=starts, interval=interval, timezone=timezone)


def _first_bucket(
    table: DatasetTable,
    last_closed: datetime,
    *,
    interval: timedelta,
    timezone: str,
    limits: RunLimits,
) -> datetime:
    """这一拍从哪个桶开始算。

    ⚠ 从没算过的表**只算最近一个已关闭的桶**，不倒着补历史：补历史是回填
    （第 6 期）那件显式触发的事，让它在建表之后自己跑起来等于随手扫全表。
    Args: table, last_closed, interval, timezone, limits。
    """
    watermark = table.last_collected_ts
    if watermark is None:
        return last_closed
    aligned = bucket_start(watermark, interval=interval, timezone=timezone)
    return shift_bucket(
        aligned,
        steps=1 - limits.recompute_tail_buckets,
        interval=interval,
        timezone=timezone,
    )


def _awaiting(
    table: DatasetTable, *, is_awaiting_columns: bool = True
) -> RunOutcome:
    """一拍什么都没算时的结论，水位原地不动。

    Args: table, is_awaiting_columns。
    """
    return RunOutcome(
        table_code=table.code,
        buckets=0,
        written=0,
        watermark=table.last_collected_ts,
        is_awaiting_columns=is_awaiting_columns,
    )
