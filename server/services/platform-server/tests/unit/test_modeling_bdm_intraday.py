"""能管公式分时查询、周期对齐和长区间分段的外部契约。"""

import json
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

import httpx
import pytest
from pydantic import ValidationError

from platform_server.apps.modeling.operators.bdm import BdmSourceConfig
from platform_server.apps.modeling.services.bdm_client import (
    BdmClient,
    BdmReadFailed,
)
from platform_server.apps.modeling.services.bdm_frame import load_frame
from platform_server.apps.modeling.services.bdm_window import (
    formula_windows,
    history_windows,
    resolve_window,
)
from platform_server.apps.modeling.services.run_pool import NodePool
from unit.test_modeling_bdm import NOW, config, connection, success


@pytest.fixture
def frame_pool() -> Iterator[NodePool]:
    pool = NodePool(factory=lambda: ThreadPoolExecutor(max_workers=1))
    try:
        yield pool
    finally:
        pool.shutdown()


def formula(**changes: object) -> BdmSourceConfig:
    return config(kind="formula", identifiers=["F1"], **changes)


@pytest.mark.parametrize("granularity", ["hour", "minute"])
def test_intraday_granularities_are_available(granularity: str) -> None:
    settings = formula(granularity=granularity)
    assert settings.granularity == granularity


@pytest.mark.parametrize("minutes", [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60])
def test_documented_minute_intervals_are_accepted(minutes: int) -> None:
    assert (
        formula(granularity="minute", interval_minutes=minutes).interval_minutes
        == minutes
    )


@pytest.mark.parametrize("minutes", [0, 7, 8, 9, 11, 45, 61])
def test_unsupported_minute_intervals_are_rejected(minutes: int) -> None:
    with pytest.raises(ValidationError):
        formula(granularity="minute", interval_minutes=minutes)


def test_long_ranges_are_allowed_but_history_requests_remain_segmented() -> (
    None
):
    settings = config(since="2020-01-01T00:00:00Z")
    window = resolve_window(settings, NOW, "Asia/Shanghai")
    period = next(history_windows(window))
    assert window.since == datetime(2020, 1, 1, tzinfo=UTC)
    assert period == {
        "startTime": "2026-10-19 00:00:00",
        "endTime": "2026-10-26 00:00:00",
    }


def test_relative_minutes_resolve_to_complete_periods() -> None:
    settings = formula(
        granularity="minute", interval_minutes=15, since="-1h", until=""
    )
    now = datetime(2026, 10, 26, 1, 1, 30, tzinfo=UTC)
    window = resolve_window(settings, now, "Asia/Shanghai")
    assert window.since == datetime(2026, 10, 26, 0, 15, tzinfo=UTC)
    assert window.until == datetime(2026, 10, 26, 1, tzinfo=UTC)
    assert list(formula_windows(window, "minute", 15)) == [
        {
            "startDate": "2026-10-26 08:15:00",
            "endDate": "2026-10-26 09:00:00",
            "granularity": "minute",
            "intervalMinutes": 15,
        }
    ]


def test_strict_intraday_alignment_rejects_seconds_and_unaligned_minutes() -> (
    None
):
    settings = formula(
        granularity="minute",
        interval_minutes=15,
        time_alignment="strict",
        since="2026-10-26T00:07:00Z",
        until="2026-10-26T01:00:00Z",
    )
    with pytest.raises(BdmReadFailed, match="对齐"):
        resolve_window(settings, NOW, "Asia/Shanghai")


def test_too_short_window_does_not_silently_query_a_different_period() -> None:
    settings = formula(
        granularity="hour",
        since="2026-10-26T00:10:00Z",
        until="2026-10-26T00:30:00Z",
    )
    with pytest.raises(BdmReadFailed, match="完整"):
        resolve_window(settings, NOW, "Asia/Shanghai")


def test_minute_formula_is_split_into_at_most_500_periods_per_request() -> None:
    window = resolve_window(formula(granularity="minute"), NOW, "Asia/Shanghai")
    periods = list(formula_windows(window, "minute"))
    assert len(periods) == 3
    assert periods[0] == {
        "startDate": "2026-10-25 15:40:00",
        "endDate": "2026-10-26 00:00:00",
        "granularity": "minute",
        "intervalMinutes": 1,
    }
    assert periods[1]["endDate"] == periods[0]["startDate"]
    assert periods[2]["endDate"] == periods[1]["startDate"]
    assert periods[2]["startDate"] == "2026-10-25 00:00:00"


@pytest.mark.parametrize("granularity", ["day", "month"])
def test_calendar_queries_keep_inclusive_dates_without_interval(
    granularity: str,
) -> None:
    window = resolve_window(
        formula(granularity=granularity), NOW, "Asia/Shanghai"
    )
    assert list(formula_windows(window, granularity)) == [
        {
            "startDate": "2026-10-25" if granularity == "day" else "2026-10-01",
            "endDate": "2026-10-25" if granularity == "day" else "2026-10-01",
            "granularity": granularity,
        }
    ]


def test_extreme_relative_range_has_a_domain_error() -> None:
    with pytest.raises(BdmReadFailed, match="时间"):
        resolve_window(config(since="-999999d"), NOW, "Asia/Shanghai")


async def test_hourly_request_keeps_time_and_excludes_end_sample(
    frame_pool: NodePool,
) -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        assert json.loads(request.content) == {
            "codes": ["F1"],
            "startDate": "2026-10-26 08:00:00",
            "endDate": "2026-10-26 10:00:00",
            "granularity": "hour",
            "intervalMinutes": 60,
        }
        return success(
            {
                "intervalMinutes": 60,
                "endExclusive": True,
                "series": [
                    {
                        "code": "F1",
                        "name": "每小时能耗",
                        "samples": [
                            {"ct": "2026-10-26 08:00:00", "value": 2},
                            {"ct": "2026-10-26 09:00:00"},
                            {"ct": "2026-10-26 10:00:00", "value": 999},
                        ],
                    }
                ],
            }
        )

    settings = formula(
        granularity="hour",
        since="2026-10-26T00:00:00Z",
        until="2026-10-26T02:00:00Z",
    )
    async with BdmClient(
        connection(), transport=httpx.MockTransport(respond)
    ) as client:
        result = await load_frame(client, settings, now=NOW, pool=frame_pool)
    assert result.rows == ((2.0,), (None,))
    assert result.columns[0].name == "每小时能耗"


@pytest.mark.parametrize(
    "metadata",
    [
        {},
        {"intervalMinutes": 30, "endExclusive": True},
        {"intervalMinutes": 60, "endExclusive": False},
    ],
)
async def test_intraday_response_must_confirm_interval_and_exclusive_end(
    metadata: dict[str, object], frame_pool: NodePool
) -> None:
    def respond(_request: httpx.Request) -> httpx.Response:
        return success(
            {
                "kind": "formula",
                "series": [{"code": "F1", "samples": []}],
                **metadata,
            }
        )

    async with BdmClient(
        connection(), transport=httpx.MockTransport(respond)
    ) as client:
        with pytest.raises(BdmReadFailed, match=r"粒度|左闭右开"):
            await load_frame(
                client, formula(granularity="hour"), now=NOW, pool=frame_pool
            )


@pytest.mark.parametrize(
    ("granularity", "minutes"), [("hour", 15), ("day", 1), ("month", 60)]
)
def test_interval_does_not_change_hour_or_calendar_semantics(
    granularity: str, minutes: int
) -> None:
    with pytest.raises(ValidationError):
        formula(granularity=granularity, interval_minutes=minutes)


def test_multiyear_monthly_range_has_adjacent_bounded_segments() -> None:
    settings = formula(granularity="month", since="2020-01-01T00:00:00Z")
    window = resolve_window(settings, NOW, "Asia/Shanghai")
    periods = list(formula_windows(window, "month"))
    assert len(periods) == 7
    assert periods[0]["startDate"] == "2025-11-01"
    assert periods[0]["endDate"] == "2026-10-01"
    assert periods[-1]["startDate"] == "2020-01-01"
    assert periods[-1]["endDate"] == "2020-10-01"


async def test_formula_sample_must_follow_requested_interval(
    frame_pool: NodePool,
) -> None:
    def respond(_request: httpx.Request) -> httpx.Response:
        return success(
            {
                "intervalMinutes": 15,
                "endExclusive": True,
                "series": [
                    {
                        "code": "F1",
                        "samples": [{"ct": "2026-10-25 08:07:00", "value": 4}],
                    }
                ],
            }
        )

    async with BdmClient(
        connection(), transport=httpx.MockTransport(respond)
    ) as client:
        with pytest.raises(BdmReadFailed, match="对齐"):
            await load_frame(
                client,
                formula(granularity="minute", interval_minutes=15),
                now=NOW,
                pool=frame_pool,
            )


@pytest.mark.parametrize("has_more", [False, True])
async def test_exact_row_limit_avoids_an_extra_request(
    has_more: bool, frame_pool: NodePool
) -> None:
    requests = 0

    def respond(_request: httpx.Request) -> httpx.Response:
        nonlocal requests
        requests += 1
        return success(
            {
                "series": [
                    {
                        "propertyId": "r1",
                        "nextOffset": 1 if has_more else None,
                        "samples": [{"ct": "2026-10-25 08:00:00", "value": 4}],
                    }
                ]
            }
        )

    async with BdmClient(
        connection(), transport=httpx.MockTransport(respond)
    ) as client:
        result = await load_frame(
            client,
            config(kind="raw", identifiers=["r1"], row_limit=1),
            now=NOW,
            pool=frame_pool,
        )
    assert result.row_count == 1
    assert result.provenance.is_truncated is has_more
    assert requests == 1
