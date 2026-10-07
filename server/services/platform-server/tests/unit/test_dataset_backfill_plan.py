"""回填计划：桶对齐、三道 clamp 与切批。

三道 clamp 每一条都必须**留下一句话**：静默裁剪的表现是「我要了一年，它补了
一个月」，而界面上看不出少了哪一段（docs/DATASET_DESIGN.md §14.3）。
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from platform_server.apps.dataset.errors import DatasetBackfillInvalid
from platform_server.apps.dataset.models import DatasetTable
from platform_server.apps.dataset.services.backfill_plan import (
    BATCH_BUCKETS,
    RAW_PATH,
    BucketGrid,
    PlanLimits,
    batch_window,
    grid_of,
    guard_bucket,
    plan_backfill,
    retention_floor,
    slice_batches,
)

SHANGHAI = "Asia/Shanghai"
HOUR = timedelta(hours=1)
HOUR_MS = 3_600_000
# 当前桶是 05:00Z（还开着），最后一个已关闭的桶是 04:00Z
NOW = datetime(2026, 8, 24, 5, 30, tzinfo=UTC)
CLOSED = datetime(2026, 8, 24, 4, 0, tzinfo=UTC)


def a_table(**overrides: object) -> DatasetTable:
    """一张按小时聚合、已启用、没有水位的台账。

    Args: overrides。
    """
    table = DatasetTable()
    table.id = uuid.UUID("0192f0c0-0000-7000-8000-0000000000aa")
    table.code = "shift_output"
    table.name = "班次产量"
    table.collect_mode = "aggregate"
    table.collect_interval_ms = HOUR_MS
    table.is_enabled = True
    table.last_collected_ts = None
    for key, value in overrides.items():
        setattr(table, key, value)
    return table


def limits(**overrides: object) -> PlanLimits:
    """一份不裁剪任何东西的口径。

    Args: overrides.
    """
    base: dict[str, object] = {
        "timezone": SHANGHAI,
        "retention_days": None,
        "recompute_tail_buckets": 2,
    }
    base.update(overrides)
    return PlanLimits(**base)  # pyright: ignore[reportArgumentType]


def grid() -> BucketGrid:
    """小时桶的网格。"""
    return grid_of(a_table(), SHANGHAI)


def test_the_range_is_snapped_onto_the_bucket_grid() -> None:
    # ⚠ 两端都按桶起点算：拿请求里那一刻当区间端点，SQL 会按整桶分组而
    # Python 按半桶记进度，两边对不上而谁都不报错
    plan = plan_backfill(
        a_table(),
        since=datetime(2026, 8, 20, 1, 17, tzinfo=UTC),
        until=datetime(2026, 8, 20, 6, 42, tzinfo=UTC),
        now=NOW,
        limits=limits(),
    )

    assert plan.first == datetime(2026, 8, 20, 1, 0, tzinfo=UTC)
    assert plan.last == datetime(2026, 8, 20, 6, 0, tzinfo=UTC)
    assert plan.total_buckets == 6
    assert plan.is_clamped is False


def test_both_ends_in_one_bucket_means_exactly_that_bucket() -> None:
    # ⚠ 区间是桶闭区间：要求结束严格晚于开始的话，想补一个桶的人得写出
    # 「桶起点 + 1 毫秒」，而写错一位就静默变成补两个桶
    plan = plan_backfill(
        a_table(),
        since=CLOSED - 5 * HOUR,
        until=CLOSED - 5 * HOUR,
        now=NOW,
        limits=limits(),
    )

    assert plan.total_buckets == 1
    assert plan.first == plan.last == CLOSED - 5 * HOUR


def test_a_backwards_range_is_rejected() -> None:
    with pytest.raises(DatasetBackfillInvalid):
        plan_backfill(
            a_table(),
            since=NOW,
            until=NOW - HOUR,
            now=NOW,
            limits=limits(),
        )


def test_the_raw_path_is_always_said_out_loud() -> None:
    # ⚠ 本仓的点位历史没有连续聚合视图，故恒为原始表。留一个永远填不上的
    # 「快路」字段等于让界面长期显示一个不存在的加速选项
    plan = plan_backfill(
        a_table(),
        since=CLOSED - 5 * HOUR,
        until=CLOSED - 4 * HOUR,
        now=NOW,
        limits=limits(),
    )

    assert RAW_PATH == "raw"
    assert any("原始表" in note for note in plan.notes)
    # 取数路径不是裁剪：算进去的话每一次回填都自称被裁过，界面上那个警告常亮
    assert plan.is_clamped is False


def test_the_retention_floor_rounds_the_boundary_bucket_up() -> None:
    # ⚠ 向上取整：跨在保留期边界上的桶只剩半桶样本，折算出来是个错的数，
    # 而它一旦写出去就永久留在台账里
    floor = retention_floor(
        grid(), now=datetime(2026, 8, 24, 5, 30, tzinfo=UTC), retention_days=1
    )

    assert floor == datetime(2026, 8, 23, 6, 0, tzinfo=UTC)


def test_a_floor_that_lands_exactly_on_a_bucket_start_is_kept() -> None:
    floor = retention_floor(
        grid(), now=datetime(2026, 8, 24, 5, 0, tzinfo=UTC), retention_days=1
    )

    assert floor == datetime(2026, 8, 23, 5, 0, tzinfo=UTC)


def test_points_kept_forever_leave_no_floor_at_all() -> None:
    assert retention_floor(grid(), now=NOW, retention_days=None) is None


def test_a_start_before_the_retention_floor_is_lifted_and_explained() -> None:
    plan = plan_backfill(
        a_table(),
        since=NOW - timedelta(days=30),
        until=CLOSED - 5 * HOUR,
        now=NOW,
        limits=limits(retention_days=2),
    )

    assert plan.first == datetime(2026, 8, 22, 6, 0, tzinfo=UTC)
    assert plan.is_clamped is True
    assert any("保留期（2 天）" in note for note in plan.notes)


def test_the_tail_the_collector_still_rewrites_is_left_alone() -> None:
    # 水位就在最后一个已关闭的桶上，尾部重算 2 格：采集器下一拍从 03:00 起写，
    # 故回填的右界只到 02:00——「采集器会写的第一个桶」本身也要让出去
    plan = plan_backfill(
        a_table(last_collected_ts=CLOSED),
        since=CLOSED - 10 * HOUR,
        until=NOW,
        now=NOW,
        limits=limits(),
    )

    assert plan.last == CLOSED - 2 * HOUR
    assert plan.is_clamped is True
    assert any("向前采集器" in note for note in plan.notes)


def test_the_guard_follows_a_watermark_that_lags_behind() -> None:
    # ⚠ 采集器从**水位**往下算：开关关了很久的表，它的射程整段压在过去。
    # 按「最近几个桶」让位会让两边同时写同一批行
    stale = CLOSED - timedelta(days=3)

    guard = guard_bucket(
        grid(), a_table(last_collected_ts=stale), now=NOW, tail=2
    )

    assert guard == stale - 2 * HOUR


def test_a_manual_table_may_be_backfilled_up_to_the_last_closed_bucket() -> (
    None
):
    # 采集器根本不碰它，没有需要让出去的尾巴
    guard = guard_bucket(
        grid(), a_table(collect_mode="manual"), now=NOW, tail=2
    )

    assert guard == CLOSED


def test_a_disabled_table_is_treated_the_same_as_a_manual_one() -> None:
    guard = guard_bucket(grid(), a_table(is_enabled=False), now=NOW, tail=2)

    assert guard == CLOSED


def test_a_range_entirely_inside_the_collector_tail_is_rejected() -> None:
    with pytest.raises(DatasetBackfillInvalid):
        plan_backfill(
            a_table(last_collected_ts=CLOSED),
            since=CLOSED - HOUR,
            until=NOW,
            now=NOW,
            limits=limits(),
        )


def test_too_many_buckets_keeps_the_newer_end_and_says_so() -> None:
    # ⚠ 留下的是**较新**的那一段：时序面的默认预期是「先看最近」，
    # 而更早的区间可以再发一次回填
    plan = plan_backfill(
        a_table(),
        since=CLOSED - 100 * HOUR,
        until=CLOSED - 90 * HOUR,
        now=NOW,
        limits=limits(max_buckets=4),
    )

    assert plan.total_buckets == 4
    assert plan.last == CLOSED - 90 * HOUR
    assert plan.first == CLOSED - 93 * HOUR
    assert plan.is_clamped is True
    assert any("最多 4 个桶" in note for note in plan.notes)


def test_all_three_clamps_can_fire_at_once() -> None:
    plan = plan_backfill(
        a_table(last_collected_ts=CLOSED),
        since=NOW - timedelta(days=90),
        until=NOW,
        now=NOW,
        limits=limits(retention_days=30, max_buckets=5),
    )

    assert plan.total_buckets == 5
    assert plan.is_clamped is True
    # 取数路径那一条不算裁剪，故三道 clamp + 一条路径 = 四句话
    assert len(plan.notes) == 4


def test_batches_tile_the_whole_range_without_gap_or_overlap() -> None:
    plan = plan_backfill(
        a_table(),
        since=CLOSED - timedelta(hours=BATCH_BUCKETS + 5),
        until=CLOSED - 3 * HOUR,
        now=NOW,
        limits=limits(),
    )

    batches = slice_batches(plan)

    assert sum(batch.count for batch in batches) == plan.total_buckets
    assert batches[0].first == plan.first
    assert batches[-1].last == plan.last
    assert [batch.count for batch in batches] == [BATCH_BUCKETS, 3]
    assert batches[1].first == batches[0].last + HOUR


def test_a_single_short_batch_counts_its_own_buckets() -> None:
    plan = plan_backfill(
        a_table(),
        since=CLOSED - 9 * HOUR,
        until=CLOSED - 5 * HOUR,
        now=NOW,
        limits=limits(),
    )

    batches = slice_batches(plan)

    assert len(batches) == 1
    assert batches[0].count == 5
    assert batch_window(plan, batches[0]).starts == (
        CLOSED - 9 * HOUR,
        CLOSED - 8 * HOUR,
        CLOSED - 7 * HOUR,
        CLOSED - 6 * HOUR,
        CLOSED - 5 * HOUR,
    )


def test_a_spring_span_keeps_its_sparse_reachable_identities() -> None:
    plan = plan_backfill(
        a_table(collect_mode="manual", collect_interval_ms=11_000),
        since=datetime(2026, 3, 8, 7, 0, tzinfo=UTC),
        until=datetime(2026, 3, 8, 7, 1, tzinfo=UTC),
        now=datetime(2026, 3, 8, 9, 0, tzinfo=UTC),
        limits=PlanLimits(
            timezone="America/New_York",
            retention_days=None,
            recompute_tail_buckets=0,
        ),
    )
    found = tuple(
        bucket
        for batch in slice_batches(plan)
        for bucket in batch_window(plan, batch).starts
    )
    assert found == (
        datetime(2026, 3, 8, 7, 0, 1, tzinfo=UTC),
        datetime(2026, 3, 8, 7, 0, 12, tzinfo=UTC),
        datetime(2026, 3, 8, 7, 0, 23, tzinfo=UTC),
        datetime(2026, 3, 8, 7, 0, 34, tzinfo=UTC),
        datetime(2026, 3, 8, 7, 0, 45, tzinfo=UTC),
        datetime(2026, 3, 8, 7, 0, 56, tzinfo=UTC),
        datetime(2026, 3, 8, 7, 59, 50, tzinfo=UTC),
    )
    assert plan.total_buckets == len(found)


def test_spring_batch_counts_match_distinct_ordered_windows() -> None:
    plan = plan_backfill(
        a_table(collect_mode="manual", collect_interval_ms=11_000),
        since=datetime(2026, 3, 8, 6, 0, tzinfo=UTC),
        until=datetime(2026, 3, 8, 8, 0, tzinfo=UTC),
        now=datetime(2026, 3, 8, 9, 0, tzinfo=UTC),
        limits=PlanLimits(
            timezone="America/New_York",
            retention_days=None,
            recompute_tail_buckets=0,
        ),
    )
    batches = slice_batches(plan)
    windows = [batch_window(plan, batch).starts for batch in batches]
    found = tuple(bucket for starts in windows for bucket in starts)
    assert found == tuple(sorted(set(found)))
    assert (
        sum(batch.count for batch in batches)
        == len(found)
        == plan.total_buckets
    )
    assert all(
        batch.count == len(starts)
        for batch, starts in zip(batches, windows, strict=True)
    )


def test_retention_keeps_complete_spring_cells_and_excludes_partial_ghost() -> (
    None
):
    cutoff = datetime(2026, 3, 8, 7, 0, 0, 500_000, tzinfo=UTC)
    plan = plan_backfill(
        a_table(collect_mode="manual", collect_interval_ms=11_000),
        since=cutoff,
        until=datetime(2026, 3, 8, 7, 1, tzinfo=UTC),
        now=cutoff + timedelta(days=1),
        limits=PlanLimits(
            timezone="America/New_York",
            retention_days=1,
            recompute_tail_buckets=0,
        ),
    )
    found = tuple(
        bucket
        for batch in slice_batches(plan)
        for bucket in batch_window(plan, batch).starts
    )
    assert plan.first == datetime(2026, 3, 8, 7, 0, 1, tzinfo=UTC)
    assert datetime(2026, 3, 8, 7, 59, 50, tzinfo=UTC) not in found
    assert plan.total_buckets == 6
    assert plan.is_clamped


def test_retention_requires_both_autumn_occurrences_to_be_complete() -> None:
    cutoff = datetime(2026, 11, 1, 5, 30, tzinfo=UTC)
    plan = plan_backfill(
        a_table(collect_mode="manual", collect_interval_ms=60_000),
        since=datetime(2026, 11, 1, 6, 29, tzinfo=UTC),
        until=datetime(2026, 11, 1, 6, 30, tzinfo=UTC),
        now=cutoff + timedelta(days=1),
        limits=PlanLimits(
            timezone="America/New_York",
            retention_days=1,
            recompute_tail_buckets=0,
        ),
    )
    assert plan.first == plan.last == datetime(2026, 11, 1, 6, 30, tzinfo=UTC)
    assert plan.total_buckets == 1
    assert plan.is_clamped


def test_naive_backfill_request_keeps_the_existing_utc_interpretation() -> None:
    plan = plan_backfill(
        a_table(collect_mode="manual"),
        since=CLOSED.replace(tzinfo=None),
        until=CLOSED.replace(tzinfo=None),
        now=NOW.replace(tzinfo=None),
        limits=limits(),
    )
    assert plan.first == plan.last == CLOSED


def test_extreme_request_is_limited_before_transition_scanning() -> None:
    plan = plan_backfill(
        a_table(collect_mode="manual", collect_interval_ms=1000),
        since=datetime.min.replace(tzinfo=UTC),
        until=datetime.max.replace(tzinfo=UTC),
        now=NOW,
        limits=limits(max_buckets=4),
    )
    assert plan.total_buckets == 4
    assert plan.last == datetime(2026, 8, 24, 5, 29, 59, tzinfo=UTC)
    assert plan.first == plan.last - timedelta(seconds=3)
    assert any("最多 4 个桶" in note for note in plan.notes)


def test_bounded_request_keeps_the_tail_before_a_stale_guard() -> None:
    watermark = datetime(2020, 1, 1, tzinfo=UTC)
    plan = plan_backfill(
        a_table(collect_interval_ms=1000, last_collected_ts=watermark),
        since=datetime(2019, 12, 1, tzinfo=UTC),
        until=datetime(2026, 3, 8, tzinfo=UTC),
        now=datetime(2026, 3, 9, tzinfo=UTC),
        limits=limits(max_buckets=4),
    )
    assert plan.total_buckets == 4
    assert plan.last == watermark - timedelta(seconds=2)
    assert plan.first == plan.last - timedelta(seconds=3)
    assert any("向前采集器" in note for note in plan.notes)
