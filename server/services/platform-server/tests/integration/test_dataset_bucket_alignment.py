"""Python 的 `bucket_start` 与真库的 `time_bucket` 必须逐格相同。

⚠ 这是台账里最容易静默写歪的一处（docs/DATASET_DESIGN.md §4.5.1）：SQL 按一种
边界分桶、Python 按另一种算水位时，行会成批落进**隔壁那一格**，而数值本身合法，
没有任何一处会报错。故这条对着真库逐格比对，不用假件——假件等于把要验的东西
自己再实现一遍。
"""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from integration.dataset_helpers import ArchiveWriter, Sample
from platform_server.apps.collect.services import ReadOnlyHistorySource
from platform_server.apps.dataset.services.aggregate import (
    BucketWindow,
    PointColumn,
    aggregate_cells,
    build_bucket_query,
)
from platform_server.apps.dataset.services.buckets import (
    bucket_start,
    build_bucket_expression,
)

pytestmark = pytest.mark.requires_postgres

# 覆盖三类桶宽：整除一天的、不整除一天的、以及不整除「两个原点之差」的。
# ⚠ 中间那一类是关键——1s/1min/1h/1d 在 2000-01-01 与 2000-01-03 两个原点下
# 算出来一模一样，只用它们测等于没测
WIDTHS = (
    timedelta(seconds=1),
    timedelta(seconds=7),
    timedelta(seconds=11),
    timedelta(seconds=90),
    timedelta(minutes=7),
    timedelta(minutes=13),
    timedelta(hours=1),
    timedelta(hours=5),
    timedelta(hours=7),
    timedelta(days=1),
)
# 含夏令时的两个时区：本仓出厂值不跨夏令时，但时区是配置项
ZONES = ("Asia/Shanghai", "UTC", "America/New_York", "Europe/Berlin")
# 含一个春季前跳日与一个秋季回拨日
MOMENTS = (
    datetime(2026, 8, 24, 3, 17, 43, 512_000, tzinfo=UTC),
    datetime(1999, 5, 5, 20, 1, 2, tzinfo=UTC),
    datetime(2026, 3, 8, 9, 30, tzinfo=UTC),
    datetime(2026, 11, 1, 5, 45, tzinfo=UTC),
)


async def bucket_in_sql(
    history_source: ReadOnlyHistorySource,
    *,
    moment: datetime,
    width: timedelta,
    zone: str,
) -> datetime:
    """问真库：这一刻的桶起点是哪一刻。

    Args: history_source, moment, width, zone。
    """
    rows = await history_source.fetch_all(
        # SQL 表达式来自生产常量；时刻、桶宽与时区全部绑定。
        "SELECT "  # noqa: S608
        + build_bucket_expression()
        + " AS bucket_start FROM (SELECT CAST(:moment AS timestamptz) AS ts)"
        " AS sample",
        {"bucket_width": width, "moment": moment, "bucket_timezone": zone},
    )
    found = rows[0]["bucket_start"]
    assert isinstance(found, datetime)
    return found.astimezone(UTC)


@pytest.mark.parametrize("zone", ZONES)
async def test_every_width_and_moment_lands_where_postgres_puts_it(
    history_source: ReadOnlyHistorySource, zone: str
) -> None:
    mismatched: list[str] = []
    for width in WIDTHS:
        for moment in MOMENTS:
            in_sql = await bucket_in_sql(
                history_source, moment=moment, width=width, zone=zone
            )
            in_python = bucket_start(moment, interval=width, timezone=zone)
            if in_sql != in_python:
                mismatched.append(
                    f"{zone} {width} {moment:%Y-%m-%dT%H:%M:%S}:"
                    f" sql={in_sql.isoformat()} py={in_python.isoformat()}"
                )
    assert mismatched == []


async def test_the_seven_minute_width_would_catch_a_wrong_origin(
    history_source: ReadOnlyHistorySource,
) -> None:
    """这条是上面那张表的守门人：它保证矩阵里有一个能分辨原点的宽度。

    ⚠ 两个候选原点（2000-01-01 与 2000-01-03）差 172800 秒。整除它的桶宽在两种
    取法下算出来完全相同，全用那类宽度的话，原点写错也一路全绿。
    """
    width = timedelta(minutes=7)
    assert 172_800 % int(width.total_seconds()) != 0
    moment = datetime(2026, 8, 24, 3, 17, 43, tzinfo=UTC)
    in_sql = await bucket_in_sql(
        history_source, moment=moment, width=width, zone="Asia/Shanghai"
    )
    wrong_origin_would_give = in_sql + timedelta(minutes=4)
    assert (
        bucket_start(moment, interval=width, timezone="Asia/Shanghai")
        == in_sql
        != wrong_origin_would_give
    )


@pytest.mark.parametrize(
    "case",
    [
        (
            datetime(2026, 11, 1, 5, 45, tzinfo=UTC),
            timedelta(seconds=1),
            datetime(2026, 11, 1, 6, 45, tzinfo=UTC),
        ),
        (
            datetime(2026, 11, 1, 6, 45, tzinfo=UTC),
            timedelta(seconds=1),
            datetime(2026, 11, 1, 6, 45, tzinfo=UTC),
        ),
        (
            datetime(2026, 3, 8, 7, 0, tzinfo=UTC),
            timedelta(seconds=11),
            datetime(2026, 3, 8, 7, 59, 50, tzinfo=UTC),
        ),
        (
            datetime(2026, 3, 8, 7, 0, tzinfo=UTC),
            timedelta(minutes=13),
            datetime(2026, 3, 8, 7, 54, tzinfo=UTC),
        ),
    ],
    ids=(
        "autumn-first",
        "autumn-second",
        "spring-eleven-seconds",
        "spring-thirteen-minutes",
    ),
)
async def test_the_production_query_keeps_postgres_wall_clock_bucket_identity(
    history_source: ReadOnlyHistorySource,
    archive: ArchiveWriter,
    case: tuple[datetime, timedelta, datetime],
) -> None:
    moment, width, expected = case
    zone = "America/New_York"
    point_code = "dst_temperature"
    await archive.write(point_code, [Sample(ts=moment, value_num=12.0)])
    starts = (expected,)
    column = PointColumn(
        key="temperature",
        node_key=archive.node_key(point_code),
        agg="avg",
        source_id=archive.source_id,
        point_code=point_code,
    )
    rows = await history_source.fetch_all(
        *build_bucket_query(
            [column],
            aggs=["avg"],
            window=BucketWindow(starts=starts, interval=width, timezone=zone),
        )
    )
    assert [row["bucket_start"] for row in rows] == [expected]
    assert rows[0]["avg_value"] == 12.0
    assert bucket_start(moment, interval=width, timezone=zone) == expected


@pytest.mark.parametrize("case", ["autumn", "spring", "sparse"])
async def test_delta_uses_the_previous_nonempty_identity_in_real_history(
    history_source: ReadOnlyHistorySource,
    archive: ArchiveWriter,
    case: str,
) -> None:
    """前驱身份的末值可能晚于目标的最早样本，稀疏请求仍须经过中间桶。"""
    samples, starts, width = delta_case(case)
    point_code = "dst_counter"
    await archive.write(point_code, samples)
    column = PointColumn(
        key="counter",
        node_key=archive.node_key(point_code),
        agg="delta",
        source_id=archive.source_id,
        point_code=point_code,
    )
    found = await aggregate_cells(
        history_source,
        columns=[column],
        window=BucketWindow(
            starts=starts, interval=width, timezone="America/New_York"
        ),
    )
    assert {
        bucket: row["counter"].value for bucket, row in found.items()
    } == dict.fromkeys(starts, 10.0)


def delta_case(
    case: str,
) -> tuple[list[Sample], tuple[datetime, ...], timedelta]:
    """独立字面量输入，不用生产分桶函数生成期望。

    Args: case。
    """
    if case == "autumn":
        day = datetime(2026, 11, 1, tzinfo=UTC)
        readings = [(5, 29, 10.0), (5, 30, 50.0), (6, 29, 40.0)]
        starts, width = (day + timedelta(hours=6, minutes=30),), timedelta(
            minutes=1
        )
    else:
        day = datetime(2026, 3, 8, tzinfo=UTC)
        readings = [(7, 0, 50.0), (7, 58, 40.0)]
        starts, width = (day + timedelta(hours=7, minutes=54),), timedelta(
            minutes=13
        )
        if case == "sparse":
            readings = [
                (6, 50, 10.0),
                (7, 0, 50.0),
                (7, 8, 20.0),
                (7, 21, 40.0),
            ]
            starts = (day + timedelta(hours=7, minutes=7), *starts)
    samples = [
        Sample(ts=day + timedelta(hours=hour, minutes=minute), value_num=value)
        for hour, minute, value in readings
    ]
    return samples, starts, width


@dataclass(frozen=True)
class TransactionHistory:
    """同一只读事务里执行生产查询，验证 session 时区不会改变回看边界。"""

    session: AsyncSession

    async def fetch_all(
        self, sql: str, params: Mapping[str, object]
    ) -> list[dict[str, object]]:
        result = await self.session.execute(text(sql), params)
        return [dict(row) for row in result.mappings()]


@pytest.mark.parametrize("session_timezone", ["UTC", "America/New_York"])
@pytest.mark.parametrize(
    "case", ["spring-day", "fall-day", "spring-two-days", "fall-two-days"]
)
async def test_delta_lookback_is_absolute_in_each_database_session_timezone(
    archive: ArchiveWriter, session_timezone: str, case: str
) -> None:
    samples, starts, width, expected = lookback_case(case)
    point_code = "dst_lookback"
    await archive.write(point_code, samples)
    column = PointColumn(
        key="counter",
        node_key=archive.node_key(point_code),
        agg="delta",
        source_id=archive.source_id,
        point_code=point_code,
    )
    async with archive.database.session() as session:
        await session.execute(text("SET TRANSACTION READ ONLY"))
        await session.execute(
            text("SELECT set_config('TimeZone', :timezone, true)"),
            {"timezone": session_timezone},
        )
        found = await aggregate_cells(
            TransactionHistory(session),
            columns=[column],
            window=BucketWindow(
                starts=starts, interval=width, timezone="America/New_York"
            ),
        )
    assert list(found) == [starts[-1]]
    assert found[starts[-1]]["counter"].value == expected


def lookback_case(
    case: str,
) -> tuple[list[Sample], tuple[datetime, ...], timedelta, float | None]:
    """24/48 小时的字面量前驱；秋季超时前驱即使 context 读到也不可接力。

    Args: case。
    """
    if case == "spring-day":
        target = datetime(2026, 3, 8, 7, tzinfo=UTC)
        previous, width, expected = (
            target - timedelta(days=1),
            timedelta(hours=1),
            10.0,
        )
        starts = (target,)
    elif case == "fall-day":
        target = datetime(2026, 11, 1, 6, tzinfo=UTC)
        previous, width, expected = (
            target - timedelta(hours=25),
            timedelta(hours=1),
            None,
        )
        starts = (target - timedelta(hours=2), target)
    elif case == "spring-two-days":
        target = datetime(2026, 3, 8, 8, tzinfo=UTC)
        previous, width, expected = (
            target - timedelta(hours=47),
            timedelta(hours=2),
            10.0,
        )
        starts = (target,)
    else:
        target = datetime(2026, 11, 2, 9, tzinfo=UTC)
        previous, width, expected = (
            target - timedelta(hours=49),
            timedelta(hours=2),
            None,
        )
        starts = (target - timedelta(hours=2), target)
    samples = [
        Sample(previous + timedelta(minutes=1), 40.0),
        Sample(target + timedelta(minutes=1), 50.0),
    ]
    return samples, starts, width, expected
