"""桶聚合：把 `collect.point_history` 按台账周期折成一格一格的数（§4.4）。

⚠ 跨 schema **只读**（ADR-0003）：这里的每一条都是 SELECT，走归档库自己的只读
连接，不与 platform 的写事务同池、也不与它 JOIN。
⚠ 台账自己出这一份**八档**白名单，不去用采集读侧那份五档的 `AGGREGATE_SQL`：
那是点位历史对外契约，两个消费者的口径不该互相牵连；更要命的是那一份连同
`build_aggregate_query` 一起带着**采集的时区**，两个时区配得不一样时行会成批
落进隔壁那一格且完全不报错（§4.5.1）。
"""

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from types import MappingProxyType
from typing import Protocol

from lib.utils.timeutils import to_utc
from platform_server.apps.dataset.services.buckets import shift_bucket
from timeseries import HISTORY_SCHEMA, HISTORY_TABLE

# 完全限定的表名。⚠ 不靠 search_path：只读连接万一没设对，未限定的表名会静默
# 命中 platform schema 里某张同名表
TABLE = f"{HISTORY_SCHEMA}.{HISTORY_TABLE}"

# 一格里装得下什么：数、文本、或者空
type CellValue = float | int | str | None

AGG_COUNT = "count"
AGG_DELTA = "delta"

# 八档口径各自的 SQL 表达式（§4.4）。
# ⚠ `last` / `first` 必须带 `FILTER (WHERE value_num IS NOT NULL)`：timescaledb
# 的 `last(v, t)` 取的是「时间最大那一行的 v」，那一行的 v 是 NULL 就回 NULL，
# 于是一个末尾恰好写过一条空值的桶会把整格算空——而它上面的样本明明都在。
# ⚠ `delta` 在 SQL 这一侧只出**本桶末值**：减数在桶外，跨桶相减在 Python 里做。
AGGREGATE_SQL: Mapping[str, str] = MappingProxyType(
    {
        "avg": "avg(value_num)",
        "min": "min(value_num)",
        "max": "max(value_num)",
        "sum": "sum(value_num)",
        AGG_COUNT: "count(value_num)",
        "first": "first(value_num, ts) FILTER (WHERE value_num IS NOT NULL)",
        "last": "last(value_num, ts) FILTER (WHERE value_num IS NOT NULL)",
        AGG_DELTA: "last(value_num, ts) FILTER (WHERE value_num IS NOT NULL)",
    }
)
# 数值取不到时还原文本值的两档。⚠ 只有 `last` / `first` 有这一档：非数值点位
# 只有 `value_text`，而对文本求平均是没有意义的（§4.4）
TEXT_FALLBACK_SQL: Mapping[str, str] = MappingProxyType(
    {
        "first": "first(value_text, ts) FILTER (WHERE value_text IS NOT NULL)",
        "last": "last(value_text, ts) FILTER (WHERE value_text IS NOT NULL)",
    }
)

# 桶内的数值样本数与文本样本数。⚠ 不是装饰：2 个样本的 avg 与 3600 个样本的 avg
# 在界面上长得一模一样（§4.3c）
NUM_COUNT = "num_count"
TEXT_COUNT = "text_count"

# `delta` 减数的回看窗口。⚠ 必须有下界：稀疏点位会让计划器沿 6 小时一个 chunk
# 一路摸到保留期尽头，而那是一次跨月的顺序扫描（§4.4）
_LOOKBACK_FACTOR = 24
_LOOKBACK_FLOOR = timedelta(hours=6)
_LOOKBACK_CEILING = timedelta(days=2)


class UnknownAggregate(ValueError):
    """列上配着一个不在八档里的聚合口径。

    ⚠ 响亮抛出而不是当成「这一格没数」：那是配置写坏了，不是数据缺失。
    文本点位配数值口径才是「空一格、不报错」的那一类（§4.4）。
    """


class HistoryReader(Protocol):
    """归档库的最小只读面。真实现是采集面的只读连接，测试用进程内假件。

    ⚠ 本模块自己声明这个面而不去 import 采集那份：功能模块之间只走对方的
    `services` 公开面，而这一面窄到一个方法，复述比耦合便宜。
    """

    async def fetch_all(
        self, sql: str, params: Mapping[str, object]
    ) -> list[dict[str, object]]: ...


@dataclass(frozen=True)
class PointColumn:
    """一列点位汇总列：绑的点位身份 + 折算口径。"""

    key: str
    node_key: str
    agg: str
    source_id: uuid.UUID
    point_code: str


@dataclass(frozen=True)
class BucketWindow:
    """一次聚合覆盖的桶序列与它的时区口径。

    ⚠ `timezone` 只能是 `PLATFORM_DATASET_BUCKET_TIMEZONE`：它同时喂给 SQL 的
    `time_bucket` 与 Python 的 `bucket_start`，两边分家就是静默写歪（§4.5.1）。
    """

    starts: tuple[datetime, ...]
    interval: timedelta
    timezone: str

    @property
    def range_start(self) -> datetime:
        """第一个桶的起点。"""
        return self.starts[0]

    @property
    def range_end(self) -> datetime:
        """最后一个桶的右开界。"""
        return shift_bucket(
            self.starts[-1],
            steps=1,
            interval=self.interval,
            timezone=self.timezone,
        )


@dataclass(frozen=True)
class Cell:
    """一格：折算出来的值 + 撑起它的样本数。

    ⚠ `value is None` 就是「这一格算不出来」，绝不是 0（D3）。
    """

    value: CellValue
    samples: int


def required_aggs(columns: Sequence[PointColumn]) -> tuple[str, ...]:
    """这批列一共要跑哪几档，去重后按名字排序；有未知档当场抛。

    Args: columns。
    """
    unknown = sorted({c.agg for c in columns} - set(AGGREGATE_SQL))
    if unknown:
        raise UnknownAggregate(f"未知的聚合口径：{'、'.join(unknown)}")
    return tuple(sorted({column.agg for column in columns}))


def lookback_span(interval: timedelta) -> timedelta:
    """`delta` 找减数时往回看多久：`clamp(桶宽 × 24, 6h, 2d)`。

    Args: interval。
    """
    return min(
        max(interval * _LOOKBACK_FACTOR, _LOOKBACK_FLOOR), _LOOKBACK_CEILING
    )


def build_bucket_query(
    columns: Sequence[PointColumn],
    *,
    aggs: Sequence[str],
    window: BucketWindow,
) -> tuple[str, dict[str, object]]:
    """构造这批点位在这段桶序列上的分桶聚合查询。

    ⚠ `timezone =>` 不能省：不带它 `time_bucket` 按 UNIX 纪元对齐，东八区的日桶
    会从当地 08:00 开始，07:00 的数据落进前一天（§4.5）。
    Args: columns, aggs（已过白名单）, window。
    """
    params = _window_params(columns, window)
    predicate = str(params.pop("predicate"))
    # ⚠ 绑 `timedelta` 而不是 `'1 hour'` 这样的字符串：`CAST($1 AS interval)`
    # 让驱动把这个参数认成 interval，喂字符串是当场 DataError，而拿假件断言
    # SQL 文本的单元测试完全看不出来
    params["bucket_width"] = window.interval
    params["bucket_timezone"] = window.timezone
    # ⚠ 恰好等于「桶数 × 点位数」，也就是 GROUP BY 能产出的行数上限：它拦的是
    # 「桶序列算错、扫出一片计划外的桶」，正常路径上一行都截不掉
    params["row_limit"] = len(window.starts) * len(_points_of(columns))
    bucket = (
        "time_bucket(CAST(:bucket_width AS interval), ts,"
        " timezone => :bucket_timezone)"
    )
    sql = (
        # 理由：拼进这段 SQL 的只有本模块的白名单表达式与常量，全部外部输入
        # （点位、区间、桶宽、时区、条数）一律走绑定参数
        f"SELECT source_id, point_code, {bucket} AS bucket_start,"  # noqa: S608
        f" {_select_list(aggs)}"
        f" FROM {TABLE}"
        f" WHERE {predicate} AND ts >= :range_start AND ts < :range_end"
        " GROUP BY source_id, point_code, bucket_start"
        " ORDER BY bucket_start ASC, source_id ASC, point_code ASC"
        " LIMIT :row_limit"
    )
    return sql, params


def build_previous_end_query(
    columns: Sequence[PointColumn], *, window: BucketWindow
) -> tuple[str, dict[str, object]]:
    """构造 `delta` 减数的查询：每个点位在区间之前最近的一个数值末值。

    ⚠ 下界不能省，理由见 `lookback_span`。⚠ 也不按桶取：中间的空桶不打断接力，
    末值一直有效到下次变化为止（§4.4）。
    Args: columns, window。
    """
    points = _points_of(columns)
    predicate, params = _point_predicate(points)
    merged: dict[str, object] = dict(params)
    merged["range_start"] = window.range_start
    merged["lookback_start"] = window.range_start - lookback_span(
        window.interval
    )
    sql = (
        # 理由同上：拼进来的只有本模块常量与占位符名
        "SELECT DISTINCT ON (source_id, point_code)"  # noqa: S608
        " source_id, point_code, value_num"
        f" FROM {TABLE}"
        f" WHERE {predicate} AND ts >= :lookback_start AND ts < :range_start"
        " AND value_num IS NOT NULL"
        " ORDER BY source_id ASC, point_code ASC, ts DESC"
    )
    return sql, merged


async def aggregate_cells(
    reader: HistoryReader,
    *,
    columns: Sequence[PointColumn],
    window: BucketWindow,
) -> dict[datetime, dict[str, Cell]]:
    """把这批列在这段桶序列上折成 `{桶起点: {列key: 格}}`。

    ⚠ 一条样本都没有的桶压根不出现在结果里——空桶不写行（D3）。
    Args: reader, columns, window。
    """
    if not columns:
        return {}
    aggs = required_aggs(columns)
    rows = await reader.fetch_all(
        *build_bucket_query(columns, aggs=aggs, window=window)
    )
    grouped = _group_by_point(rows, columns)
    seeds = (
        await _previous_ends(reader, columns, window)
        if AGG_DELTA in aggs
        else {}
    )
    cells: dict[datetime, dict[str, Cell]] = {}
    for column in columns:
        series = grouped.get(column.node_key, [])
        found = _column_cells(column, series, seeds.get(column.node_key))
        for bucket, cell in found.items():
            cells.setdefault(bucket, {})[column.key] = cell
    return cells


def _select_list(aggs: Sequence[str]) -> str:
    """按需要的档位渲染出选择列表。别名即 `{档}_value` / `{档}_text`。

    Args: aggs。
    """
    parts = [
        f"count(value_num) AS {NUM_COUNT}",
        f"count(value_text) AS {TEXT_COUNT}",
    ]
    parts.extend(f"{AGGREGATE_SQL[agg]} AS {agg}_value" for agg in aggs)
    parts.extend(
        f"{TEXT_FALLBACK_SQL[agg]} AS {agg}_text"
        for agg in aggs
        if agg in TEXT_FALLBACK_SQL
    )
    return ", ".join(parts)


def _points_of(
    columns: Sequence[PointColumn],
) -> tuple[tuple[uuid.UUID, str], ...]:
    """这批列一共绑了哪几个点位，去重后定序。

    ⚠ 定序不是洁癖：占位符名按位置生成，顺序一变同一批列就会渲染出两条不同的
    SQL，而 PG 的计划缓存是按语句文本索引的。
    Args: columns。
    """
    return tuple(
        sorted(
            {(column.source_id, column.point_code) for column in columns},
            key=lambda point: (str(point[0]), point[1]),
        )
    )


def _point_predicate(
    points: Sequence[tuple[uuid.UUID, str]],
) -> tuple[str, dict[str, str]]:
    """把点位集合渲染成 `(source_id, point_code) IN (…)` 与它的绑定参数。

    ⚠ 值一律绑定参数：点位编码是用户可控输入，拼进 SQL 就是注入面。
    Args: points。
    """
    clauses: list[str] = []
    params: dict[str, str] = {}
    for position, (source_id, point_code) in enumerate(points):
        source_name = f"source_{position}"
        code_name = f"code_{position}"
        clauses.append(f"(CAST(:{source_name} AS uuid), :{code_name})")
        params[source_name] = str(source_id)
        params[code_name] = point_code
    return f"(source_id, point_code) IN ({', '.join(clauses)})", params


def _window_params(
    columns: Sequence[PointColumn], window: BucketWindow
) -> dict[str, object]:
    """点位谓词与区间边界的绑定参数。

    Args: columns, window。
    """
    predicate, params = _point_predicate(_points_of(columns))
    merged: dict[str, object] = dict(params)
    merged["predicate"] = predicate
    merged["range_start"] = window.range_start
    merged["range_end"] = window.range_end
    return merged


async def _previous_ends(
    reader: HistoryReader,
    columns: Sequence[PointColumn],
    window: BucketWindow,
) -> dict[str, float]:
    """每个点位在区间之前的最后一个数值末值，`{node_key: 值}`。

    Args: reader, columns, window。
    """
    rows = await reader.fetch_all(
        *build_previous_end_query(columns, window=window)
    )
    index = _point_index(columns)
    found: dict[str, float] = {}
    for row in rows:
        node_key = index.get(_row_point(row))
        value = _as_number(row.get("value_num"))
        if node_key is not None and value is not None:
            found[node_key] = float(value)
    return found


def _point_index(columns: Sequence[PointColumn]) -> dict[tuple[str, str], str]:
    """`(source_id 文本, point_code) → node_key` 的反查表。

    Args: columns。
    """
    return {
        (str(column.source_id), column.point_code): column.node_key
        for column in columns
    }


def _row_point(row: Mapping[str, object]) -> tuple[str, str]:
    """结果行属于哪个点位。

    Args: row。
    """
    return str(row.get("source_id")), str(row.get("point_code"))


def _group_by_point(
    rows: Sequence[Mapping[str, object]], columns: Sequence[PointColumn]
) -> dict[str, list[tuple[datetime, Mapping[str, object]]]]:
    """把结果行按点位归拢，每组按桶起点升序（SQL 已经排好）。

    Args: rows, columns。
    """
    index = _point_index(columns)
    grouped: dict[str, list[tuple[datetime, Mapping[str, object]]]] = {}
    for row in rows:
        node_key = index.get(_row_point(row))
        bucket = row.get("bucket_start")
        if node_key is None or not isinstance(bucket, datetime):
            continue
        grouped.setdefault(node_key, []).append((to_utc(bucket), row))
    return grouped


def _column_cells(
    column: PointColumn,
    series: Sequence[tuple[datetime, Mapping[str, object]]],
    seed: float | None,
) -> dict[datetime, Cell]:
    """一列在它那串桶上的取值。

    Args: column, series（按桶升序）, seed（`delta` 的第一个减数）。
    """
    if column.agg == AGG_DELTA:
        return _delta_cells(series, seed)
    return {bucket: _plain_cell(column.agg, row) for bucket, row in series}


def _plain_cell(agg: str, row: Mapping[str, object]) -> Cell:
    """非 `delta` 的七档在一个桶里的取值。

    ⚠ `count` 为 0 时这一格是**空**而不是 0：桶里一条数值样本都没有（文本点位
    配了数值口径就是这样）不等于「这一小时是零条」（D3、§4.4）。
    Args: agg, row。
    """
    samples = _as_count(row.get(NUM_COUNT))
    if agg == AGG_COUNT:
        return Cell(value=samples or None, samples=samples)
    value = _as_number(row.get(f"{agg}_value"))
    if value is not None:
        return Cell(value=value, samples=samples)
    if agg not in TEXT_FALLBACK_SQL:
        return Cell(value=None, samples=samples)
    text = _as_text(row.get(f"{agg}_text"))
    if text is not None:
        return Cell(value=text, samples=_as_count(row.get(TEXT_COUNT)))
    return Cell(value=None, samples=samples)


def _delta_cells(
    series: Sequence[tuple[datetime, Mapping[str, object]]],
    seed: float | None,
) -> dict[datetime, Cell]:
    """`delta` 的跨桶接力：`本桶末值 − 上一桶末值`（§4.4）。

    ⚠ 中间的空桶不打断接力——它们压根不在 `series` 里，而 `previous` 一直留着，
    末值有效到下次变化为止。
    Args: series（按桶升序）, seed。
    """
    found: dict[datetime, Cell] = {}
    previous = seed
    for bucket, row in series:
        samples = _as_count(row.get(NUM_COUNT))
        end = _as_number(row.get(f"{AGG_DELTA}_value"))
        if end is None:
            found[bucket] = Cell(value=None, samples=samples)
            continue
        found[bucket] = Cell(value=_increment(previous, end), samples=samples)
        previous = float(end)
    return found


def _increment(previous: float | None, end: float) -> float | None:
    """一个桶的增量；算不出来就是空。

    ⚠ 两条都是「不猜」：取不到上一桶末值 → 空，**绝不拿本桶的 first 顶替**
    （那是无声退化回旧口径，界面上与真 delta 长得一模一样）；结果为负 → 空，
    **绝不写 0**（计数器清零/换表意味着真实增量无从得知，不是「没有增量」）。
    Args: previous, end。
    """
    if previous is None:
        return None
    step = end - previous
    return None if step < 0 else step


def _as_number(raw: object) -> float | int | None:
    """把结果列收窄成数；不是数就当没有。

    ⚠ 布尔要单独挡掉：它在 Python 里是 int 的子类，不挡就会有一个 True 悄悄
    变成 1 落进台账。
    Args: raw。
    """
    if isinstance(raw, bool) or not isinstance(raw, int | float):
        return None
    return raw


def _as_text(raw: object) -> str | None:
    """把结果列收窄成文本；不是文本就当没有。

    Args: raw。
    """
    return raw if isinstance(raw, str) else None


def _as_count(raw: object) -> int:
    """把计数列收窄成整数；取不到按 0 算。

    Args: raw。
    """
    if isinstance(raw, bool) or not isinstance(raw, int):
        return 0
    return raw
