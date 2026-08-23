"""Python 的 `bucket_start` 与真库的 `time_bucket` 必须逐格相同。

⚠ 这是台账里最容易静默写歪的一处（docs/DATASET_DESIGN.md §4.5.1）：SQL 按一种
边界分桶、Python 按另一种算水位时，行会成批落进**隔壁那一格**，而数值本身合法，
没有任何一处会报错。故这条对着真库逐格比对，不用假件——假件等于把要验的东西
自己再实现一遍。
"""

from datetime import UTC, datetime, timedelta

import pytest

from platform_server.apps.collect.services import ReadOnlyHistorySource
from platform_server.apps.dataset.services.buckets import bucket_start

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
        "SELECT time_bucket(CAST(:width AS interval), CAST(:moment AS"
        " timestamptz), timezone => :zone) AS bucket_start",
        {"width": width, "moment": moment, "zone": zone},
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
