"""外库适配层的纯逻辑：时区换算的两个方向与两条 SQL 的形状。

⚠ 时区换算错了不会报错，只会让整屏数据整体平移 8 小时；SQL 形状错了则会静默
退化成全表扫描。两者都只能靠断言字面量钉住。
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from lib.errors import DependencyUnavailable
from platform_server.apps.hvac.errors import (
    SourceObjectShapeMismatch,
    SourceUnavailable,
)
from platform_server.apps.hvac.schemas import TimeWindow
from platform_server.apps.hvac.services.ac_source_reader import (
    AcSourceReader,
    build_samples_sql,
    build_series_sql,
    to_source_time,
    to_utc,
)

SHANGHAI = ZoneInfo("Asia/Shanghai")
OBJECT = "KTStartData_K01"
TWO_COLUMNS = ("workshop_temp_avg", "fan_frequency")


def source_time(text: str) -> datetime:
    """外库那边的 naive 当地时。

    ⚠ 外库的时间列没有时区信息，这正是被测的口径本身，不是漏标。
    Args: text（`YYYY-MM-DDTHH:MM:SS`）。
    """
    return datetime.fromisoformat(text)


def test_utc_input_becomes_naive_local_time_for_the_source() -> None:
    moment = datetime(2026, 8, 12, 0, 0, tzinfo=UTC)
    assert to_source_time(moment, SHANGHAI) == source_time(
        "2026-08-12T08:00:00"
    )


def test_the_source_naive_time_reads_back_as_utc() -> None:
    assert to_utc(source_time("2026-08-12T08:00:00"), SHANGHAI) == datetime(
        2026, 8, 12, 0, 0, tzinfo=UTC
    )


def test_the_two_conversions_are_inverse_of_each_other() -> None:
    # ⚠ 只有在源时区没有夏令时时才成立；换成有夏令时的时区这条会红
    moment = datetime(2026, 1, 31, 16, 30, tzinfo=UTC)
    assert to_utc(to_source_time(moment, SHANGHAI), SHANGHAI) == moment


def test_a_non_utc_input_is_converted_not_truncated() -> None:
    moment = datetime(2026, 8, 12, 5, 0, tzinfo=ZoneInfo("Asia/Tokyo"))
    assert to_source_time(moment, SHANGHAI) == source_time(
        "2026-08-12T04:00:00"
    )


def test_samples_sql_seeks_by_timestamp_and_never_offsets() -> None:
    assert build_samples_sql(OBJECT, TWO_COLUMNS) == (
        "SELECT TOP (:row_limit) [CT], [workshop_temp_avg], [fan_frequency]"
        " FROM [KTStartData_K01]"
        " WHERE [CT] >= :anchor AND [CT] < :range_end"
        " ORDER BY [CT] ASC"
    )


def test_series_sql_groups_by_a_constant_bucket_origin() -> None:
    assert build_series_sql(OBJECT, ("workshop_temp_avg",)) == (
        "SELECT DATEADD(minute,"
        " (DATEDIFF(minute, '2000-01-01', [CT]) / :bucket_minutes)"
        " * :bucket_minutes, '2000-01-01') AS bucket_ts,"
        " AVG([workshop_temp_avg]) AS [workshop_temp_avg]"
        " FROM [KTStartData_K01]"
        " WHERE [CT] >= :range_start AND [CT] < :range_end"
        " GROUP BY DATEDIFF(minute, '2000-01-01', [CT]) / :bucket_minutes"
        " ORDER BY bucket_ts ASC"
    )


@pytest.mark.parametrize(
    "hostile",
    ["KT;DROP TABLE x", "KT-01", "KT 01", "KTStartData_K01\n", ""],
    ids=["statement", "hyphen", "space", "newline", "empty"],
)
def test_a_hostile_object_name_never_reaches_the_sql(hostile: str) -> None:
    # ⚠ 这是最后一道防线：对象名是人填的，且标识符不能参数化
    with pytest.raises(ValueError, match="标识符不合法"):
        build_samples_sql(hostile, TWO_COLUMNS)


@dataclass
class StubSource:
    """只读源的假件：要么给固定的行，要么整个不可用。"""

    rows: list[dict[str, object]] = field(default_factory=list)
    columns: dict[str, dict[str, str]] = field(default_factory=dict)
    failure: Exception | None = None

    async def fetch_all(
        self, sql: str, params: Mapping[str, object]
    ) -> list[dict[str, object]]:
        self.asked = (sql, dict(params))
        if self.failure is not None:
            raise self.failure
        return list(self.rows)

    async def describe_columns(
        self, object_names: Sequence[str]
    ) -> dict[str, dict[str, str]]:
        if self.failure is not None:
            raise self.failure
        # 外库的标识符大小写不敏感，假件照同一个口径回答
        wanted = {name.lower() for name in object_names}
        return {
            name: columns
            for name, columns in self.columns.items()
            if name.lower() in wanted
        }


def reader_over(source: StubSource) -> AcSourceReader:
    """把假件包成真的读取面。

    Args: source。
    """
    return AcSourceReader(source=source, timezone="Asia/Shanghai")


def a_window() -> TimeWindow:
    """一个一天长的 UTC 区间。"""
    start = datetime(2026, 8, 12, 0, 0, tzinfo=UTC)
    return TimeWindow(start=start, end=start + timedelta(days=1))


async def test_a_driver_outage_surfaces_as_a_source_level_error() -> None:
    # ⚠ 基础设施异常不许裸露给上层：业务层不该认识 DependencyUnavailable
    source = StubSource(failure=DependencyUnavailable("外库挂了"))
    with pytest.raises(SourceUnavailable):
        await reader_over(source).fetch_samples(
            source_object=OBJECT,
            columns=TWO_COLUMNS,
            window=a_window(),
            row_limit=10,
        )


async def test_a_driver_outage_during_discovery_is_also_converted() -> None:
    source = StubSource(failure=DependencyUnavailable("外库挂了"))
    with pytest.raises(SourceUnavailable):
        await reader_over(source).describe(OBJECT)


async def test_describe_matches_the_object_name_case_insensitively() -> None:
    # ⚠ 外库标识符大小写不敏感，回来的表名未必与问的那个逐字相同
    source = StubSource(columns={OBJECT: {"CT": "datetime"}})
    found = await reader_over(source).describe(OBJECT.lower())
    assert found == {"CT": "datetime"}


async def test_an_unknown_object_describes_as_no_columns() -> None:
    assert await reader_over(StubSource()).describe(OBJECT) == {}


async def test_a_time_column_that_is_not_a_time_is_a_shape_mismatch() -> None:
    # 厂商换了列的类型时，错误要指向形状，而不是变成一个 500
    source = StubSource(rows=[{"CT": "2026-08-12", "workshop_temp_avg": 1.0}])
    with pytest.raises(SourceObjectShapeMismatch):
        await reader_over(source).fetch_samples(
            source_object=OBJECT,
            columns=TWO_COLUMNS,
            window=a_window(),
            row_limit=10,
        )


async def test_the_bound_parameters_carry_local_time_not_utc() -> None:
    source = StubSource(rows=[])
    await reader_over(source).fetch_samples(
        source_object=OBJECT,
        columns=TWO_COLUMNS,
        window=a_window(),
        row_limit=7,
    )
    assert source.asked[1] == {
        "row_limit": 7,
        "anchor": source_time("2026-08-12T08:00:00"),
        "range_end": source_time("2026-08-13T08:00:00"),
    }


async def test_buckets_bind_the_chosen_width_and_the_local_range() -> None:
    source = StubSource(rows=[])
    await reader_over(source).fetch_buckets(
        source_object=OBJECT,
        columns=TWO_COLUMNS,
        window=a_window(),
        bucket_minutes=30,
    )
    assert source.asked[1] == {
        "bucket_minutes": 30,
        "range_start": source_time("2026-08-12T08:00:00"),
        "range_end": source_time("2026-08-13T08:00:00"),
    }
