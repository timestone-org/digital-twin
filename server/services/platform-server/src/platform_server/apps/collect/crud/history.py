"""归档宽表的读侧查询。**跨 schema 只读**，见 ADR-0003 与 ADR-0001。

⚠ 这里的每一条都是 `SELECT`，走的是独立的只读连接：`collect` schema 归
collector-server 写独占，平台侧只许读。**不许跨 schema JOIN、不许建外键、
不许把两个 schema 放进同一个事务**——那三样都会让「写独占」形同虚设。
⚠ 列名不写字面量，一律取自 `timeseries.schema`：列名改了而另一侧没改，
表现是 import 错误，不是运行期空结果。
"""

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol

from timeseries import HISTORY_SCHEMA, HISTORY_TABLE

# 完全限定的表名。⚠ 不靠 search_path：只读连接万一没设对，未限定的表名会静默
# 命中 platform schema 里某张同名表
TABLE = f"{HISTORY_SCHEMA}.{HISTORY_TABLE}"

_SELECT_COLUMNS = "source_id, point_code, ts, value_num, value_text, quality"
_ORDER = "ts ASC, source_id ASC, point_code ASC"
# 键集翻页的锚点。⚠ 必须与 ORDER BY 的列一字不差，少一列就会在同一毫秒的多个
# 点位之间漏行——而漏的那几行不会有任何提示
_CURSOR_CLAUSE = (
    "(ts, source_id, point_code)"
    " > (:after_ts, CAST(:after_source_id AS uuid), :after_point_code)"
)


class HistorySource(Protocol):
    """归档库的最小只读面。真实现打 Postgres，测试用进程内假件。"""

    async def fetch_all(
        self, sql: str, params: Mapping[str, object]
    ) -> list[dict[str, object]]: ...


@dataclass(frozen=True)
class PointRef:
    """一个点位在归档表里的复合身份。"""

    source_id: uuid.UUID
    point_code: str


@dataclass(frozen=True)
class HistoryWindow:
    """一次历史查询的区间与容量。

    ⚠ `range_start` / `range_end` 双向有界是硬要求：单边开区间会让计划器扫遍
    全部分块，而那张表按 6 小时切块、按月计有上百块。
    """

    points: tuple[PointRef, ...]
    range_start: str
    range_end: str
    row_limit: int


@dataclass(frozen=True)
class HistoryCursor:
    """键集翻页的锚点，来自上一页最后一行。"""

    ts: str
    source_id: str
    point_code: str


def _point_predicate(points: Sequence[PointRef]) -> tuple[str, dict[str, str]]:
    """把点位集合渲染成 `(source_id, point_code) IN (…)` 与它的绑定参数。

    ⚠ 值一律绑定参数：点位编码是用户可控输入，拼进 SQL 就是注入面。
    Args: points。
    """
    clauses: list[str] = []
    params: dict[str, str] = {}
    for position, point in enumerate(points):
        source_name = f"source_{position}"
        code_name = f"code_{position}"
        clauses.append(f"(CAST(:{source_name} AS uuid), :{code_name})")
        params[source_name] = str(point.source_id)
        params[code_name] = point.point_code
    joined = ", ".join(clauses)
    return f"(source_id, point_code) IN ({joined})", params


def _window_params(window: HistoryWindow) -> dict[str, object]:
    predicate, params = _point_predicate(window.points)
    merged: dict[str, object] = dict(params)
    merged["range_start"] = window.range_start
    merged["range_end"] = window.range_end
    merged["row_limit"] = window.row_limit
    merged["predicate"] = predicate
    return merged


def build_range_query(
    window: HistoryWindow, cursor: HistoryCursor | None
) -> tuple[str, dict[str, object]]:
    """构造一页历史读数的查询。

    Args: window, cursor（上一页的锚点，首页给 None）。
    """
    params = _window_params(window)
    predicate = str(params.pop("predicate"))
    conditions = [predicate, "ts >= :range_start", "ts < :range_end"]
    if cursor is not None:
        conditions.append(_CURSOR_CLAUSE)
        params["after_ts"] = cursor.ts
        params["after_source_id"] = cursor.source_id
        params["after_point_code"] = cursor.point_code
    where = " AND ".join(conditions)
    sql = (
        # 理由：拼进这段 SQL 的只有本模块的常量与 `_point_predicate` 生成的
        # 占位符名，全部外部输入一律走绑定参数
        f"SELECT {_SELECT_COLUMNS} FROM {TABLE}"  # noqa: S608
        f" WHERE {where} ORDER BY {_ORDER} LIMIT :row_limit"
    )
    return sql, params


def build_aggregate_query(
    window: HistoryWindow, *, aggregate_sql: str, interval: str, timezone: str
) -> tuple[str, dict[str, object]]:
    """构造一次分桶聚合的查询。

    ⚠ `timezone =>` 不能省：不带它 `time_bucket` 按 UNIX 纪元对齐，东八区的
    日桶会从当地 08:00 开始，07:00 的数据落进前一天。
    Args: window, aggregate_sql（白名单渲染好的表达式）, interval, timezone。
    """
    params = _window_params(window)
    predicate = str(params.pop("predicate"))
    params["bucket_width"] = interval
    params["bucket_timezone"] = timezone
    bucket = (
        "time_bucket(CAST(:bucket_width AS interval), ts,"
        " timezone => :bucket_timezone)"
    )
    sql = (
        # 理由：`aggregate_sql` 来自 `AGGREGATE_SQL` 白名单，`bucket` 是本模块
        # 常量，其余外部输入（窗口、时区、点位、区间）一律走绑定参数
        f"SELECT source_id, point_code, {bucket} AS bucket_start,"  # noqa: S608
        f" {aggregate_sql} AS bucket_value,"
        " count(value_num) AS sample_count"
        f" FROM {TABLE}"
        f" WHERE {predicate} AND ts >= :range_start AND ts < :range_end"
        " GROUP BY source_id, point_code, bucket_start"
        " ORDER BY bucket_start ASC, source_id ASC, point_code ASC"
        " LIMIT :row_limit"
    )
    return sql, params
