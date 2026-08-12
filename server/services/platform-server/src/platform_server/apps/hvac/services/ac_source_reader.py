"""外部只读库的适配层：SQL 形状、时区换算与驱动异常收敛只在这里发生。

外部既成事实（视图的列形状、CT 的时区口径、厂商台账的尾随回车符）见
docs/AC_DATA_DESIGN.md §2，直读而不落地的理由见 docs/adr/0006。
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol
from zoneinfo import ZoneInfo

from lib.db import quote_identifier
from lib.errors import DependencyUnavailable
from platform_server.apps.hvac.datasets import SOURCE_TIME_COLUMN
from platform_server.apps.hvac.errors import (
    SourceObjectShapeMismatch,
    SourceUnavailable,
)
from platform_server.apps.hvac.schemas import TimeWindow

# 聚合桶的原点，与 DATEDIFF 的基准同一个字面量
BUCKET_ORIGIN = "2000-01-01"
# 聚合结果里桶起点的列名
BUCKET_TIME_COLUMN = "bucket_ts"
# 对外只说不可用，不外泄外库的地址、库名与 SQL
_UNAVAILABLE = "外部数据源暂时不可用，请稍后重试"

_SHAPED_OBJECTS_SQL = (
    "SELECT TABLE_NAME AS object_name"
    " FROM INFORMATION_SCHEMA.COLUMNS"
    " WHERE COLUMN_NAME IN ({placeholders})"
    " GROUP BY TABLE_NAME"
    " HAVING COUNT(DISTINCT COLUMN_NAME) = :required_count"
    " ORDER BY TABLE_NAME ASC"
)
# 厂商自己的空调台账，只用来给下拉框补一个能认出位置的名字
_CAPTIONS_SQL = "SELECT device_id, Caption FROM [KTInfo]"


class SqlSource(Protocol):
    """只读 SQL 源的最小读取面。真实实现是 `lib.db.ReadOnlySqlSource`。"""

    async def fetch_all(
        self, sql: str, params: Mapping[str, object]
    ) -> list[dict[str, object]]: ...

    async def describe_columns(
        self, object_names: Sequence[str]
    ) -> dict[str, dict[str, str]]: ...


@dataclass(frozen=True)
class SourceRow:
    """外库回来的一行：时刻已换算成 UTC，测点值原样带着（含 None）。"""

    ts: datetime
    values: dict[str, object]


def to_source_time(moment: datetime, zone: ZoneInfo) -> datetime:
    """UTC 时刻 → 外库那边的 naive 当地时。

    Args: moment, zone。
    """
    return moment.astimezone(zone).replace(tzinfo=None)


def to_utc(naive: datetime, zone: ZoneInfo) -> datetime:
    """外库的 naive 当地时 → UTC 时刻。

    ⚠ 前提是源时区没有夏令时（Asia/Shanghai 自 1991 年起没有），故不存在
    一个本地时刻对应两个 UTC 时刻的情况。换成有夏令时的时区要补歧义处理。
    Args: naive, zone。
    """
    return naive.replace(tzinfo=zone).astimezone(UTC)


def build_samples_sql(source_object: str, columns: Sequence[str]) -> str:
    """逐行取数的 SQL。

    ⚠ 这里确实在拼 SQL：标识符不能参数化。安全靠三条——对象名与列名全部过
    `quote_identifier` 的白名单加方括号引用，列名只来自代码里的目录常量，
    而所有**取值**一律绑定参数。
    ⚠ 禁用 OFFSET：实测 OFFSET 400000 是 594 ms，游标式是 5 ms。
    Args: source_object, columns。
    """
    time_column = quote_identifier(SOURCE_TIME_COLUMN)
    selected = ", ".join(quote_identifier(name) for name in columns)
    return (
        # 理由：标识符不能参数化，安全由上面那三条保证；取值一律绑定参数
        f"SELECT TOP (:row_limit) {time_column}, {selected}"  # noqa: S608
        f" FROM {quote_identifier(source_object)}"
        f" WHERE {time_column} >= :anchor AND {time_column} < :range_end"
        f" ORDER BY {time_column} ASC"
    )


def build_series_sql(source_object: str, columns: Sequence[str]) -> str:
    """按分钟桶聚合的 SQL。桶内 AVG 自动跳过 NULL，整桶全空则给 NULL。

    ⚠ 用 DATEDIFF 不用 DATEDIFF_BIG：以 2000-01-01 为原点，分钟差到 2026 年
    约 1.4×10⁷，离 int 上限很远，而 DATEDIFF 的兼容性更宽。
    Args: source_object, columns。
    """
    time_column = quote_identifier(SOURCE_TIME_COLUMN)
    bucket = (
        f"DATEDIFF(minute, '{BUCKET_ORIGIN}', {time_column})"
        " / :bucket_minutes"
    )
    averages = ", ".join(
        f"AVG({quote_identifier(name)}) AS {quote_identifier(name)}"
        for name in columns
    )
    return (
        # 理由：标识符不能参数化，安全由上面那三条保证；取值一律绑定参数
        f"SELECT DATEADD(minute, ({bucket}) * :bucket_minutes,"  # noqa: S608
        f" '{BUCKET_ORIGIN}') AS {BUCKET_TIME_COLUMN}, {averages}"
        f" FROM {quote_identifier(source_object)}"
        f" WHERE {time_column} >= :range_start AND {time_column} < :range_end"
        f" GROUP BY {bucket}"
        f" ORDER BY {BUCKET_TIME_COLUMN} ASC"
    )


class AcSourceReader:
    """外部只读库的读取面。时区换算与驱动异常收敛都收在这一层。"""

    def __init__(self, *, source: SqlSource, timezone: str) -> None:
        self._source = source
        # ⚠ 时区名非法要在装配时就炸，不能拖到第一次查询才发现
        self._zone = ZoneInfo(timezone)

    async def list_bindable_objects(
        self, required_columns: Sequence[str]
    ) -> list[str]:
        """列出列形状齐备的对象。

        ⚠ 按形状过滤，不按名字前缀：同前缀下混着几个只有 4 列、连时间列都
        没有的非时序视图，按名字过滤会把它们放进下拉框。
        Args: required_columns。
        """
        params: dict[str, object] = {
            f"column_{position}": name
            for position, name in enumerate(required_columns)
        }
        placeholders = ", ".join(f":{key}" for key in params)
        params["required_count"] = len(set(required_columns))
        rows = await self._query(
            _SHAPED_OBJECTS_SQL.format(placeholders=placeholders), params
        )
        return [str(row["object_name"]) for row in rows]

    async def list_captions(self) -> dict[str, str]:
        """厂商台账里的设备名，按设备号索引。

        ⚠ 它的文本字段带尾随回车符，不 strip 就会让「按设备号对上」永远失败。
        """
        rows = await self._query(_CAPTIONS_SQL, {})
        return {
            str(row["device_id"]).strip(): str(row["Caption"]).strip()
            for row in rows
            if row.get("device_id") is not None
            and row.get("Caption") is not None
        }

    async def describe(self, source_object: str) -> dict[str, str]:
        """一个对象的「列名 → 数据类型」，对象不存在时给空字典。

        ⚠ 外库的标识符大小写不敏感，回来的表名未必与问的那个逐字相同，
        故按小写比对，否则存在的对象会被判成不存在。
        Args: source_object。
        """
        try:
            found = await self._source.describe_columns([source_object])
        except DependencyUnavailable as error:
            raise SourceUnavailable(_UNAVAILABLE) from error
        lowered = {name.lower(): columns for name, columns in found.items()}
        return lowered.get(source_object.lower(), {})

    async def fetch_samples(
        self,
        *,
        source_object: str,
        columns: Sequence[str],
        window: TimeWindow,
        row_limit: int,
    ) -> list[SourceRow]:
        """区间内的原始行，按时刻升序。

        Args: source_object, columns, window, row_limit。
        """
        rows = await self._query(
            build_samples_sql(source_object, columns),
            {
                "row_limit": row_limit,
                "anchor": to_source_time(window.start, self._zone),
                "range_end": to_source_time(window.end, self._zone),
            },
        )
        return [self._to_row(row, SOURCE_TIME_COLUMN, columns) for row in rows]

    async def fetch_buckets(
        self,
        *,
        source_object: str,
        columns: Sequence[str],
        window: TimeWindow,
        bucket_minutes: int,
    ) -> list[SourceRow]:
        """区间内按桶聚合的行，按桶起点升序。

        Args: source_object, columns, window, bucket_minutes。
        """
        rows = await self._query(
            build_series_sql(source_object, columns),
            {
                "bucket_minutes": bucket_minutes,
                "range_start": to_source_time(window.start, self._zone),
                "range_end": to_source_time(window.end, self._zone),
            },
        )
        return [self._to_row(row, BUCKET_TIME_COLUMN, columns) for row in rows]

    def _to_row(
        self,
        row: Mapping[str, object],
        time_column: str,
        columns: Sequence[str],
    ) -> SourceRow:
        moment = row.get(time_column)
        if not isinstance(moment, datetime):
            raise SourceObjectShapeMismatch("数据源对象的时间列不是时间类型")
        return SourceRow(
            ts=to_utc(moment, self._zone),
            values={name: row.get(name) for name in columns},
        )

    async def _query(
        self, sql: str, params: Mapping[str, object]
    ) -> list[dict[str, object]]:
        try:
            return await self._source.fetch_all(sql, params)
        except DependencyUnavailable as error:
            raise SourceUnavailable(_UNAVAILABLE) from error
