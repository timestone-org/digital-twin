"""桶对齐与行幂等的口径。

⚠ 这里每一条错了都**不会报错**：桶算歪一格只是把数记进了隔壁那一格，值本身
合法；`row_id` 的构造式变一个字符只是让每个历史桶再长出一行，两行看起来都对。
真库那一侧的逐格比对在 `tests/integration/test_dataset_bucket_alignment.py`。
"""

import uuid
from datetime import UTC, datetime, timedelta, timezone

import pytest

from platform_server.apps.dataset.services.buckets import (
    BUCKET_ORIGIN,
    ROW_NAMESPACE,
    bucket_interval,
    bucket_sequence,
    bucket_start,
    collected_row_id,
    shift_bucket,
)

SHANGHAI = "Asia/Shanghai"
NEW_YORK = "America/New_York"
HOUR = timedelta(hours=1)
TABLE_ID = uuid.UUID("0192f0c0-0000-7000-8000-0000000000aa")


def test_the_origin_is_the_monday_that_postgres_aligns_on() -> None:
    # ⚠ 是 2000-01-03 而不是 2000-01-01，且对全部桶宽都如此。两者差 172800 秒，
    # 故 1s/1min/1h/1d 这些整除它的桶宽看不出区别——写成 01-01 时只有 7 分钟、
    # 7 小时这类桶宽会整体错开，而它们在界面上完全正常
    monday = datetime(2000, 1, 3)  # noqa: DTZ001 —— 原点是本地墙钟，不带时区
    assert monday == BUCKET_ORIGIN


@pytest.mark.parametrize(
    ("interval_ms", "timezone", "expected"),
    [
        # 与真库 time_bucket(…, timezone => …) 的取值逐字相同，取自实测
        (1_000, SHANGHAI, "2026-08-24T03:17:43+00:00"),
        (7_000, SHANGHAI, "2026-08-24T03:17:43+00:00"),
        (11_000, SHANGHAI, "2026-08-24T03:17:33+00:00"),
        (90_000, SHANGHAI, "2026-08-24T03:16:30+00:00"),
        (420_000, SHANGHAI, "2026-08-24T03:12:00+00:00"),
        (3_600_000, SHANGHAI, "2026-08-24T03:00:00+00:00"),
        (25_200_000, SHANGHAI, "2026-08-23T23:00:00+00:00"),
        (86_400_000, SHANGHAI, "2026-08-23T16:00:00+00:00"),
        (420_000, "UTC", "2026-08-24T03:16:00+00:00"),
        (86_400_000, NEW_YORK, "2026-08-23T04:00:00+00:00"),
    ],
)
def test_a_moment_lands_where_postgres_puts_it(
    interval_ms: int, timezone: str, expected: str
) -> None:
    moment = datetime(2026, 8, 24, 3, 17, 43, 512_000, tzinfo=UTC)
    found = bucket_start(
        moment, interval=bucket_interval(interval_ms), timezone=timezone
    )
    assert found.isoformat() == expected


def test_the_day_bucket_starts_at_local_midnight_not_at_utc_midnight() -> None:
    # 不带 timezone 的 time_bucket 按 UNIX 纪元对齐，东八区的日桶会从当地
    # 08:00 开始，而 07:00 的数据落进前一天——这条盯的就是那个错
    moment = datetime(2026, 8, 24, 7, 0, tzinfo=UTC)
    found = bucket_start(moment, interval=timedelta(days=1), timezone=SHANGHAI)
    assert found == datetime(2026, 8, 23, 16, 0, tzinfo=UTC)


def test_a_moment_exactly_on_a_boundary_belongs_to_the_bucket_it_opens() -> (
    None
):
    boundary = datetime(2026, 8, 24, 3, 0, tzinfo=UTC)
    assert bucket_start(boundary, interval=HOUR, timezone=SHANGHAI) == boundary


def test_stepping_back_lands_on_the_previous_bucket() -> None:
    bucket = datetime(2026, 8, 24, 3, 0, tzinfo=UTC)
    found = shift_bucket(bucket, steps=-2, interval=HOUR, timezone=SHANGHAI)
    assert found == datetime(2026, 8, 24, 1, 0, tzinfo=UTC)


def test_stepping_across_a_daylight_jump_follows_the_wall_clock() -> None:
    # ⚠ 桶按**本地墙钟**对齐，故跨夏令时那一天相邻两个桶在绝对时间上并不相差
    # 一个桶宽。在 UTC 上直接加减会与 PG 差一小时，而那一小时不会有任何提示
    before = bucket_start(
        datetime(2026, 3, 8, 6, 30, tzinfo=UTC),
        interval=timedelta(days=1),
        timezone=NEW_YORK,
    )
    following = shift_bucket(
        before, steps=1, interval=timedelta(days=1), timezone=NEW_YORK
    )
    assert (following - before) == timedelta(hours=23)


def test_the_sequence_covers_both_ends() -> None:
    first = datetime(2026, 8, 24, 0, 0, tzinfo=UTC)
    last = datetime(2026, 8, 24, 3, 0, tzinfo=UTC)
    found = bucket_sequence(first, last, interval=HOUR, timezone=SHANGHAI)
    assert found[0] == first
    assert found[-1] == last
    assert len(found) == 4


def test_a_single_bucket_sequence_is_not_empty() -> None:
    only = datetime(2026, 8, 24, 0, 0, tzinfo=UTC)
    found = bucket_sequence(only, only, interval=HOUR, timezone=SHANGHAI)
    assert found == (only,)


def test_the_row_id_is_frozen_against_the_bucket_identity() -> None:
    # ⚠ 命名空间或构造式一变就是主键漂移：每个历史桶会再长出一行，全程不报错。
    # 这条把两者一起钉成字面量
    bucket = datetime(2026, 8, 24, 3, 0, tzinfo=UTC)
    assert str(ROW_NAMESPACE) == "bf25a465-a19f-50ac-8e3d-66fd281f38ae"
    assert str(collected_row_id(TABLE_ID, bucket)) == (
        "02d9c2cd-7422-53bf-8c45-611cd882f7c6"
    )


def test_the_same_instant_written_two_ways_gets_one_row_id() -> None:
    # ⚠ `+08:00` 与 `Z` 是同一个时刻的两种写法：不强制 UTC 就会算出两个 id，
    # 于是同一个桶长出两行
    as_utc = datetime(2026, 8, 24, 3, 0, tzinfo=UTC)
    as_local = as_utc.astimezone(timezone(timedelta(hours=8)))
    assert as_local.isoformat() != as_utc.isoformat()
    assert collected_row_id(TABLE_ID, as_utc) == collected_row_id(
        TABLE_ID, as_local
    )


def test_the_repeated_autumn_hour_resolves_the_way_postgres_does() -> None:
    # ⚠ 回拨那一小时的本地时刻出现两次，PG 的 AT TIME ZONE 取的是**后一次**
    # （回拨之后的标准时）。Python 默认 fold=0 取前一次，于是那一小时里的桶
    # 会整体比 PG 早一小时——一年只错一小时，而那一小时的数看起来完全正常
    moment = datetime(2026, 11, 1, 5, 45, tzinfo=UTC)
    found = bucket_start(
        moment, interval=timedelta(seconds=1), timezone=NEW_YORK
    )
    assert found == datetime(2026, 11, 1, 6, 45, tzinfo=UTC)


def test_two_tables_never_share_a_row_id_for_the_same_bucket() -> None:
    bucket = datetime(2026, 8, 24, 3, 0, tzinfo=UTC)
    other = uuid.UUID("0192f0c0-0000-7000-8000-0000000000bb")
    assert collected_row_id(TABLE_ID, bucket) != collected_row_id(other, bucket)
