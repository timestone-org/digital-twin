"""DST 桶身份、物理取数边界和已关闭水位必须共同成立。"""

from datetime import UTC, datetime

import pytest

from platform_server.apps.dataset.models import DatasetTable
from platform_server.apps.dataset.services.collect_run import (
    RunLimits,
    _window_of,
)

NEW_YORK = "America/New_York"


def aggregate_table(interval_ms: int) -> DatasetTable:
    return DatasetTable(
        collect_mode="aggregate",
        collect_interval_ms=interval_ms,
        is_enabled=True,
        last_collected_ts=None,
    )


@pytest.mark.parametrize(
    "interval_ms", [1_000, 1_500, 11_000, 60_000, 780_000, 3_600_000]
)
def test_a_spring_pass_never_reads_the_open_or_future_sample_window(
    interval_ms: int,
) -> None:
    now = datetime(2026, 3, 8, 7, 5, tzinfo=UTC)
    window = _window_of(
        aggregate_table(interval_ms),
        now=now,
        timezone=NEW_YORK,
        limits=RunLimits(recompute_tail_buckets=0, max_buckets_per_tick=240),
    )
    assert window is not None
    assert window.range_end <= now
    assert window.starts == tuple(sorted(set(window.starts)))


def test_the_spring_ghost_watermark_is_an_identity_and_is_not_realigned() -> (
    None
):
    table = aggregate_table(11_000)
    watermark = datetime(2026, 3, 8, 7, 59, 50, tzinfo=UTC)
    table.last_collected_ts = watermark
    window = _window_of(
        table,
        now=datetime(2026, 3, 8, 8, 2, tzinfo=UTC),
        timezone=NEW_YORK,
        limits=RunLimits(recompute_tail_buckets=1, max_buckets_per_tick=3),
    )
    assert window is not None
    assert window.starts[0] == watermark
    assert window.starts == tuple(sorted(set(window.starts)))


def test_the_first_autumn_occurrence_does_not_close_the_repeated_hour() -> None:
    now = datetime(2026, 11, 1, 5, 45, tzinfo=UTC)
    window = _window_of(
        aggregate_table(3_600_000),
        now=now,
        timezone=NEW_YORK,
        limits=RunLimits(recompute_tail_buckets=0, max_buckets_per_tick=240),
    )
    assert window is not None
    assert window.starts == (datetime(2026, 11, 1, 4, 0, tzinfo=UTC),)
    assert window.range_end == datetime(2026, 11, 1, 5, 0, tzinfo=UTC)


def test_an_off_grid_watermark_resumes_on_the_floor() -> None:
    # 15 分钟表改成 1 小时后，旧水位 02:15Z 不在新网格上；照常移格会抛异常，
    # 这张表从此再也不采
    table = aggregate_table(3_600_000)
    table.last_collected_ts = datetime(2026, 8, 24, 2, 15, tzinfo=UTC)
    window = _window_of(
        table,
        now=datetime(2026, 8, 24, 5, 30, tzinfo=UTC),
        timezone="Asia/Shanghai",
        limits=RunLimits(recompute_tail_buckets=1, max_buckets_per_tick=240),
    )
    assert window is not None
    assert window.starts[0] == datetime(2026, 8, 24, 2, 0, tzinfo=UTC)
    assert window.starts[-1] == datetime(2026, 8, 24, 4, 0, tzinfo=UTC)


def test_a_tick_cap_not_above_the_tail_still_moves_the_watermark_forward() -> (
    None
):
    # ⚠ 上限 ≤ 尾部重算格数时，每拍只重写旧桶：水位原地不动甚至倒退
    table = aggregate_table(60_000)
    watermark = datetime(2026, 8, 24, 2, 32, tzinfo=UTC)
    table.last_collected_ts = watermark
    window = _window_of(
        table,
        now=datetime(2026, 8, 24, 5, 30, tzinfo=UTC),
        timezone="Asia/Shanghai",
        limits=RunLimits(recompute_tail_buckets=3, max_buckets_per_tick=1),
    )
    assert window is not None
    assert window.starts[-1] > watermark
