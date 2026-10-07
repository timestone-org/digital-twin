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
