"""桶对齐与行幂等的口径。

⚠ 这里每一条错了都**不会报错**：桶算歪一格只是把数记进了隔壁那一格，值本身
合法；`row_id` 的构造式变一个字符只是让每个历史桶再长出一行，两行看起来都对。
真库那一侧的逐格比对在 `tests/integration/test_dataset_bucket_alignment.py`。
"""

import uuid
from datetime import UTC, datetime, timedelta, timezone
from time import tzset

import pytest

from platform_server.apps.dataset.services.bucket_grid import (
    BucketDescriptor,
    BucketGrid,
)
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


@pytest.mark.parametrize(
    ("interval", "expected"),
    [
        (timedelta(seconds=11), datetime(2026, 3, 8, 7, 59, 50, tzinfo=UTC)),
        (timedelta(minutes=13), datetime(2026, 3, 8, 7, 54, tzinfo=UTC)),
    ],
)
def test_a_bucket_in_the_spring_gap_uses_the_pre_transition_offset(
    interval: timedelta, expected: datetime
) -> None:
    found = bucket_start(
        datetime(2026, 3, 8, 7, 0, tzinfo=UTC),
        interval=interval,
        timezone=NEW_YORK,
    )
    assert found == expected


def test_stepping_over_the_spring_gap_uses_distinct_reachable_identities() -> (
    None
):
    found = shift_bucket(
        datetime(2026, 3, 8, 6, tzinfo=UTC),
        steps=1,
        interval=HOUR,
        timezone=NEW_YORK,
    )
    assert found == datetime(2026, 3, 8, 7, tzinfo=UTC)


def test_two_tables_never_share_a_row_id_for_the_same_bucket() -> None:
    bucket = datetime(2026, 8, 24, 3, 0, tzinfo=UTC)
    other = uuid.UUID("0192f0c0-0000-7000-8000-0000000000bb")
    assert collected_row_id(TABLE_ID, bucket) != collected_row_id(other, bucket)


def test_the_previous_hour_skips_the_empty_spring_cell() -> None:
    found = shift_bucket(
        datetime(2026, 3, 8, 7, tzinfo=UTC),
        steps=-1,
        interval=HOUR,
        timezone=NEW_YORK,
    )
    assert found == datetime(2026, 3, 8, 6, tzinfo=UTC)


def test_the_spring_hour_sequence_has_only_distinct_identities() -> None:
    found = bucket_sequence(
        datetime(2026, 3, 8, 6, tzinfo=UTC),
        datetime(2026, 3, 8, 8, tzinfo=UTC),
        interval=HOUR,
        timezone=NEW_YORK,
    )
    assert found == tuple(
        datetime(2026, 3, 8, hour, tzinfo=UTC) for hour in (6, 7, 8)
    )


def test_an_odd_width_sequence_is_strictly_ordered_across_the_gap() -> None:
    found = bucket_sequence(
        datetime(2026, 3, 8, 6, 55, 1, tzinfo=UTC),
        datetime(2026, 3, 8, 8, 5, 9, tzinfo=UTC),
        interval=timedelta(seconds=11),
        timezone=NEW_YORK,
    )
    assert found == tuple(sorted(set(found)))
    assert datetime(2026, 3, 8, 7, 59, 50, tzinfo=UTC) in found


def test_a_gap_projection_steps_from_its_original_wall_label() -> None:
    found = shift_bucket(
        datetime(2026, 3, 8, 7, 59, 50, tzinfo=UTC),
        steps=-1,
        interval=timedelta(seconds=11),
        timezone=NEW_YORK,
    )
    assert found == datetime(2026, 3, 8, 7, 59, 47, tzinfo=UTC)


@pytest.mark.parametrize(
    ("seconds", "identity", "source_start", "close_at"),
    [
        (
            11,
            "2026-03-08T07:59:50Z",
            "2026-03-08T07:00:00Z",
            "2026-03-08T07:00:01Z",
        ),
        (
            780,
            "2026-03-08T07:54:00Z",
            "2026-03-08T07:00:00Z",
            "2026-03-08T07:07:00Z",
        ),
        (
            3600,
            "2026-11-01T06:00:00Z",
            "2026-11-01T05:00:00Z",
            "2026-11-01T07:00:00Z",
        ),
        (
            11,
            "2026-11-01T04:59:58Z",
            "2026-11-01T04:59:58Z",
            "2026-11-01T06:00:09Z",
        ),
    ],
)
def test_a_descriptor_covers_the_complete_real_sample_preimage(
    seconds: int, identity: str, source_start: str, close_at: str
) -> None:
    grid = BucketGrid(timedelta(seconds=seconds), NEW_YORK)
    assert grid.describe(datetime.fromisoformat(identity)) == BucketDescriptor(
        datetime.fromisoformat(identity),
        datetime.fromisoformat(source_start),
        datetime.fromisoformat(close_at),
    )


@pytest.mark.parametrize(
    ("seconds", "now", "expected"),
    [
        (3600, "2026-03-08T07:05:00Z", "2026-03-08T06:00:00Z"),
        (3600, "2026-11-01T05:45:00Z", "2026-11-01T04:00:00Z"),
        (11, "2026-03-08T07:59:52Z", "2026-03-08T07:59:36Z"),
        (11, "2026-03-08T07:59:58Z", "2026-03-08T07:59:50Z"),
        (11, "2026-11-01T05:30:00Z", "2026-11-01T04:59:47Z"),
    ],
)
def test_the_closed_frontier_precedes_every_still_open_identity(
    seconds: int, now: str, expected: str
) -> None:
    grid = BucketGrid(timedelta(seconds=seconds), NEW_YORK)
    assert grid.last_closed(
        datetime.fromisoformat(now)
    ) == datetime.fromisoformat(expected)


def test_a_raw_spring_span_keeps_its_sparse_future_projection() -> None:
    grid = BucketGrid(timedelta(seconds=11), NEW_YORK)
    selected = grid.identities_for_span(
        datetime(2026, 3, 8, 7, tzinfo=UTC),
        datetime(2026, 3, 8, 7, 1, tzinfo=UTC),
    )
    expected = (
        *(
            datetime(2026, 3, 8, 7, 0, second, tzinfo=UTC)
            for second in (1, 12, 23, 34, 45, 56)
        ),
        datetime(2026, 3, 8, 7, 59, 50, tzinfo=UTC),
    )
    assert selected.sequence() == expected
    assert selected.count == 7
    assert selected.take(2).sequence() == expected[:2]
    assert selected.tail(2).sequence() == expected[-2:]


def test_retention_removes_a_partial_gap_projection_even_at_the_last_id() -> (
    None
):
    grid = BucketGrid(timedelta(seconds=11), NEW_YORK)
    selected = grid.identities_for_span(
        datetime(2026, 3, 8, 7, tzinfo=UTC),
        datetime(2026, 3, 8, 7, 1, tzinfo=UTC),
    )
    retained = grid.retained(
        selected, datetime(2026, 3, 8, 7, 0, 0, 500_000, tzinfo=UTC)
    )
    assert retained.count == 6
    assert retained.last == datetime(2026, 3, 8, 7, 0, 56, tzinfo=UTC)
    assert (
        grid.retained(selected, datetime(2026, 3, 8, 7, tzinfo=UTC)).count == 7
    )


def test_a_merged_sample_window_uses_real_sample_bounds() -> None:
    grid = BucketGrid(timedelta(seconds=11), NEW_YORK)
    starts = (
        datetime(2026, 3, 8, 7, 0, 1, tzinfo=UTC),
        datetime(2026, 3, 8, 7, 59, 50, tzinfo=UTC),
    )
    assert grid.bounds(starts) == (
        datetime(2026, 3, 8, 7, tzinfo=UTC),
        datetime(2026, 3, 8, 7, 0, 12, tzinfo=UTC),
    )


def test_compact_context_bounds_include_an_interior_gap_projection() -> None:
    grid = BucketGrid(timedelta(seconds=11), NEW_YORK)
    selected = grid.selection(
        datetime(2026, 3, 8, 7, 50, tzinfo=UTC),
        datetime(2026, 3, 8, 8, 5, tzinfo=UTC),
    )
    assert grid.selection_bounds(selected) == (
        datetime(2026, 3, 8, 7, tzinfo=UTC),
        datetime(2026, 3, 8, 8, 5, 6, tzinfo=UTC),
    )


def test_large_regular_counts_and_selections_use_compact_runs() -> None:
    first = datetime(2026, 8, 1, tzinfo=UTC)
    last = first + timedelta(seconds=200_000)
    grid = BucketGrid(timedelta(seconds=1), "UTC")
    selected = grid.selection(first, last)
    assert selected.count == 200_001
    assert len(selected.runs) == 1
    assert selected.at(199_999) == first + timedelta(seconds=199_999)
    assert grid.selection_bounds(selected) == (
        first,
        last + timedelta(seconds=1),
    )
    assert grid.count(first, last, 200_000) == 200_001
    assert grid.count(first, last, 240) == 241
    assert grid.shift(first, 200_000) == last
    assert grid.shift(last, -200_000) == first


def test_a_long_shift_accounts_for_every_repeated_autumn_hour() -> None:
    grid = BucketGrid(HOUR, NEW_YORK)
    first = datetime(2026, 1, 1, tzinfo=UTC)
    expected = first + timedelta(hours=1_000_114)
    assert grid.shift(first, 1_000_000) == expected
    assert grid.shift(expected, -1_000_000) == first


def test_identity_navigation_keeps_a_gap_projection_without_realigning() -> (
    None
):
    grid = BucketGrid(timedelta(minutes=13), NEW_YORK)
    identity = datetime(2026, 3, 8, 7, 54, tzinfo=UTC)
    assert grid.shift(identity, -1) == datetime(2026, 3, 8, 7, 46, tzinfo=UTC)
    assert grid.shift(identity, 1) == datetime(2026, 3, 8, 7, 59, tzinfo=UTC)
    assert grid.shift(identity, 0) == identity
    assert grid.floor(identity) == identity == grid.ceil(identity)


def test_identity_floor_and_ceil_do_not_wall_clock_realign_a_key() -> None:
    grid = BucketGrid(timedelta(seconds=11), NEW_YORK)
    key = datetime(2026, 3, 8, 7, 59, 51, tzinfo=UTC)
    assert grid.floor(key) == datetime(2026, 3, 8, 7, 59, 50, tzinfo=UTC)
    assert grid.ceil(key) == datetime(2026, 3, 8, 7, 59, 58, tzinfo=UTC)


def test_empty_selections_remain_empty_when_bounded_or_retained() -> None:
    grid = BucketGrid(HOUR, "UTC")
    first = datetime(2026, 8, 1, tzinfo=UTC)
    selected = grid.selection(first, first - HOUR)
    assert selected.count == 0
    assert selected.sequence() == ()
    assert selected.take(1).count == selected.tail(1).count == 0
    assert grid.retained(selected, first).count == 0
    with pytest.raises(ValueError, match="为空"):
        _ = selected.first
    with pytest.raises(ValueError, match="为空"):
        _ = selected.last
    with pytest.raises(ValueError, match="为空"):
        grid.selection_bounds(selected)
    with pytest.raises(IndexError):
        selected.at(0)


def test_unreachable_and_off_grid_keys_are_rejected_as_identities() -> None:
    grid = BucketGrid(HOUR, NEW_YORK)
    key = datetime(2026, 11, 1, 5, tzinfo=UTC)
    with pytest.raises(ValueError, match="不是可达桶身份"):
        grid.describe(key)
    with pytest.raises(ValueError, match="不是可达桶身份"):
        grid.shift(key, 1)
    with pytest.raises(ValueError, match="为空"):
        grid.bounds(())


def test_invalid_widths_spans_and_mixed_grid_subtraction_are_rejected() -> None:
    with pytest.raises(ValueError, match="必须为正"):
        BucketGrid(timedelta(0), "UTC")
    first = datetime(2026, 8, 1, tzinfo=UTC)
    grid = BucketGrid(HOUR, "UTC")
    with pytest.raises(ValueError, match="早于"):
        grid.identities_for_span(first, first - HOUR)
    hourly = grid.selection(first, first + HOUR)
    minute = BucketGrid(timedelta(minutes=1), "UTC").selection(first, first)
    with pytest.raises(ValueError, match="桶宽不一致"):
        hourly.without(minute)


def test_offset_representations_keep_the_same_identity_and_sample_window() -> (
    None
):
    grid = BucketGrid(timedelta(seconds=11), NEW_YORK)
    local_zone = timezone(timedelta(hours=8))
    since = datetime(2026, 3, 8, 7, tzinfo=UTC)
    until = since + timedelta(minutes=1)
    selected = grid.identities_for_span(
        since.astimezone(local_zone), until.astimezone(local_zone)
    )
    assert selected.count == 7
    identity = datetime(2026, 3, 8, 7, 59, 50, tzinfo=UTC)
    descriptor = grid.describe(identity.astimezone(local_zone))
    assert descriptor.identity == identity
    assert descriptor.identity.tzinfo is UTC
    assert descriptor.source_start == since


@pytest.mark.parametrize(
    "host_timezone", ["Asia/Shanghai", "America/Los_Angeles"]
)
def test_naive_inputs_are_utc_independently_of_the_host_timezone(
    host_timezone: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    grid = BucketGrid(timedelta(seconds=11), NEW_YORK)
    since = datetime(2026, 3, 8, 7, tzinfo=UTC)
    until = since + timedelta(minutes=1)
    naive = since.replace(tzinfo=None)
    with monkeypatch.context() as patch:
        patch.setenv("TZ", host_timezone)
        tzset()
        try:
            assert grid.align(naive) == grid.align(since)
            assert grid.identities_for_span(naive, until).sequence() == (
                grid.identities_for_span(since, until).sequence()
            )
            assert collected_row_id(TABLE_ID, naive) == collected_row_id(
                TABLE_ID, since
            )
        finally:
            patch.undo()
            tzset()


def test_public_identity_operations_accept_mixed_naive_and_aware_inputs() -> (
    None
):
    grid = BucketGrid(HOUR, "UTC")
    first = datetime(2026, 8, 1, tzinfo=UTC)
    naive = first.replace(tzinfo=None)
    last = first + HOUR
    selected = grid.selection(naive, last)
    assert selected.count == grid.count(naive, last, 2) == 2
    assert selected.rank(naive) == selected.between(naive, naive).count == 1
    assert grid.sequence(naive, last) == (first, last)
    assert grid.floor(naive) == grid.ceil(naive) == first
    assert grid.shift(naive, 1) == last
    assert grid.describe(naive).identity == first
    assert grid.bounds((naive, last)) == (first, last + HOUR)
    assert grid.retained(selected, naive).count == 2
    assert grid.last_closed(naive) == first - HOUR


@pytest.mark.parametrize(
    "boundary",
    [datetime.min.replace(tzinfo=UTC), datetime.max.replace(tzinfo=UTC)],
)
def test_unrepresentable_preimage_boundaries_raise_a_validation_error(
    boundary: datetime,
) -> None:
    grid = BucketGrid(HOUR, "UTC")
    with pytest.raises(ValueError, match="日期边界"):
        grid.identities_for_span(boundary, boundary)
    with pytest.raises(ValueError, match="日期边界"):
        grid.selection(boundary, boundary)
    with pytest.raises(ValueError, match="日期边界"):
        grid.describe(boundary)
