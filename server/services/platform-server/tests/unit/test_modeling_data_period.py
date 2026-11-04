"""特征帧保留明确业务周期，未知周期不根据少量时间样本猜测。"""

import uuid
from dataclasses import replace
from datetime import timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.dataset.schemas import TableOut
from platform_server.apps.dataset.services import ColumnSpec, record_read
from platform_server.apps.modeling.operators import Frame, FrameColumn, registry
from platform_server.apps.modeling.operators.frame import DataPeriod, Provenance
from platform_server.apps.modeling.operators.tabular import merged_provenance
from platform_server.apps.modeling.services import (
    bdm_frame,
    frame_source,
    preview,
    run_executor,
)
from platform_server.apps.modeling.services.bdm_window import resolve_window
from unit.test_modeling_bdm import NOW, config

FIXED_HALF_HOUR = {
    "kind": "fixed",
    "interval_ms": 1_800_000,
    "calendar_unit": None,
    "timezone": None,
}


def sample_frame() -> Frame:
    return Frame(
        columns=(FrameColumn(key="value", name="数值", dtype="number"),),
        rows=((1.0,), (2.0,)),
        index=(0, 60_000),
    )


def test_unconfigured_period_is_explicitly_unknown() -> None:
    assert preview.summarize(sample_frame())["data_period"] is None


@pytest.mark.parametrize("bucket", ["1m", "5m", "15m", "30m", "1h", "6h", "1d"])
def test_resampling_freezes_the_configured_period(bucket: str) -> None:
    widths = {
        "1m": 60_000,
        "5m": 300_000,
        "15m": 900_000,
        "30m": 1_800_000,
        "1h": 3_600_000,
        "6h": 21_600_000,
        "1d": 86_400_000,
    }
    operator, _ = registry.build("resample", {"bucket": bucket})
    result = operator.run({"frame": sample_frame()})["frame"]
    assert isinstance(result, Frame)
    assert preview.summarize(result)["data_period"] == {
        **FIXED_HALF_HOUR,
        "interval_ms": widths[bucket],
    }


@pytest.mark.parametrize(
    ("granularity", "interval_minutes", "expected"),
    [
        ("minute", 30, FIXED_HALF_HOUR),
        ("minute", None, {**FIXED_HALF_HOUR, "interval_ms": 60_000}),
        ("hour", None, {**FIXED_HALF_HOUR, "interval_ms": 3_600_000}),
        (
            "day",
            None,
            {
                "kind": "calendar",
                "interval_ms": None,
                "calendar_unit": "day",
                "timezone": "Asia/Shanghai",
            },
        ),
        (
            "month",
            None,
            {
                "kind": "calendar",
                "interval_ms": None,
                "calendar_unit": "month",
                "timezone": "Asia/Shanghai",
            },
        ),
    ],
)
def test_bdm_formula_records_duration_or_calendar_period(
    granularity: str,
    interval_minutes: int | None,
    expected: dict[str, object],
) -> None:
    settings = config(
        kind="formula",
        granularity=granularity,
        interval_minutes=interval_minutes,
    )
    frame = bdm_frame._build_frame(
        [], settings, resolve_window(settings, NOW, "Asia/Shanghai"), NOW
    )
    assert preview.summarize(frame)["data_period"] == expected


@pytest.mark.parametrize("kind", ["point", "raw"])
def test_bdm_raw_history_does_not_claim_a_formula_period(kind: str) -> None:
    settings = config(kind=kind, granularity="hour")
    frame = bdm_frame._build_frame(
        [], settings, resolve_window(settings, NOW, "Asia/Shanghai"), NOW
    )
    assert preview.summarize(frame)["data_period"] is None


@pytest.mark.parametrize(
    ("collect_mode", "row_source", "expected"),
    [
        ("aggregate", "collect", FIXED_HALF_HOUR),
        ("manual", "collect", None),
        ("aggregate", "manual", None),
        ("aggregate", "import", None),
        ("aggregate", "all", FIXED_HALF_HOUR),
    ],
)
async def test_ledger_period_only_describes_collected_aggregate_rows(
    monkeypatch: pytest.MonkeyPatch,
    collect_mode: str,
    row_source: str,
    expected: dict[str, object] | None,
) -> None:
    table_id = uuid.UUID(int=1)
    table = TableOut.model_construct(
        id=table_id, collect_mode=collect_mode, collect_interval_ms=1_800_000
    )
    frame = await load_ledger(monkeypatch, table, row_source, (0, 1_800_000))
    assert preview.summarize(frame)["data_period"] == expected


async def load_ledger(
    monkeypatch: pytest.MonkeyPatch,
    table: TableOut,
    row_source: str,
    offsets_ms: tuple[int, ...],
    row_sources: tuple[str, ...] | None = None,
) -> Frame:
    monkeypatch.setattr(
        frame_source.table_service,
        "resolve_table_code",
        AsyncMock(return_value=table.id),
    )
    monkeypatch.setattr(
        frame_source.table_service, "get_table", AsyncMock(return_value=table)
    )
    monkeypatch.setattr(
        frame_source.column_service,
        "list_column_specs",
        AsyncMock(return_value=(ColumnSpec("value", "数值", "number", ""),)),
    )
    monkeypatch.setattr(
        frame_source.record_read,
        "scan_effective",
        AsyncMock(
            return_value=record_read.EffectiveScan(
                tuple(
                    record_read.EffectiveRow(
                        NOW + timedelta(milliseconds=offset),
                        (
                            "collect"
                            if row_sources is None
                            else row_sources[position]
                        ),
                        {"value": 1.0},
                    )
                    for position, offset in enumerate(offsets_ms)
                ),
                False,
            )
        ),
    )
    async with AsyncSession() as session:
        return await frame_source.load_frame(
            session,
            request=frame_source.SourceRequest(
                "periods", (), "-1d", "", row_source, 100
            ),
            now=NOW + timedelta(days=1),
        )


@pytest.mark.parametrize(
    ("offsets_ms", "expected"),
    [
        ((0, 1_800_000, 3_600_000), None),
        ((0, 3_600_000, 5_400_000), None),
        (
            (0, 3_600_000, 7_200_000),
            {**FIXED_HALF_HOUR, "interval_ms": 3_600_000},
        ),
        ((0, 7_200_000), None),
        ((0,), None),
        ((), None),
        ((0, 0), None),
        (
            (
                *range(0, 3_600_000 * 201, 3_600_000),
                3_600_000 * 201 + 1_800_000,
            ),
            None,
        ),
    ],
    ids=[
        "old-period",
        "mixed-period",
        "consistent",
        "gap",
        "single",
        "empty",
        "duplicate",
        "late-mismatch",
    ],
)
async def test_ledger_configuration_must_agree_with_all_historical_rows(
    monkeypatch: pytest.MonkeyPatch,
    offsets_ms: tuple[int, ...],
    expected: dict[str, object] | None,
) -> None:
    table = TableOut.model_construct(
        id=uuid.UUID(int=1),
        collect_mode="aggregate",
        collect_interval_ms=3_600_000,
    )
    frame = await load_ledger(monkeypatch, table, "collect", offsets_ms)
    assert preview.summarize(frame)["data_period"] == expected


@pytest.mark.parametrize("other_source", ["manual", "import"])
async def test_all_sources_with_mixed_history_keep_the_period_unknown(
    monkeypatch: pytest.MonkeyPatch, other_source: str
) -> None:
    table = TableOut.model_construct(
        id=uuid.UUID(int=1),
        collect_mode="aggregate",
        collect_interval_ms=1_800_000,
    )
    frame = await load_ledger(
        monkeypatch, table, "all", (0, 1_800_000), ("collect", other_source)
    )
    assert preview.summarize(frame)["data_period"] is None


@pytest.mark.parametrize("operator_code", ["group_aggregate", "describe_stats"])
def test_non_temporal_results_do_not_claim_a_data_period(
    operator_code: str,
) -> None:
    frame = replace(
        sample_frame(),
        provenance=Provenance(
            data_period=DataPeriod("fixed", interval_ms=1_800_000)
        ),
    )
    operator, _ = registry.build(operator_code, {})
    result = operator.run({"frame": frame})["frame"]
    assert isinstance(result, Frame)
    assert result.index is None
    assert preview.summarize(result)["data_period"] is None


@pytest.mark.parametrize("period", [FIXED_HALF_HOUR, None])
def test_period_survives_the_total_run_preview_budget(
    monkeypatch: pytest.MonkeyPatch, period: dict[str, object] | None
) -> None:
    monkeypatch.setattr(preview, "RUN_PREVIEW_MAX_BYTES", 200)
    summary = preview.summarize(sample_frame())
    summary["data_period"] = period
    kept, is_truncated = run_executor._Budget().take({"frame": summary})
    assert is_truncated
    assert "columns" not in kept["frame"]
    assert kept["frame"]["data_period"] == period


def test_period_survives_the_last_preview_budget_tier() -> None:
    summary = preview.summarize(sample_frame())
    summary["data_period"] = FIXED_HALF_HOUR
    summary["columns"] = ["x" * preview.PREVIEW_MAX_BYTES]
    fitted, is_truncated = preview.fit_budget(summary)
    assert is_truncated
    assert preview.size_of(fitted) <= preview.PREVIEW_MAX_BYTES
    assert fitted["data_period"] == FIXED_HALF_HOUR


@pytest.mark.parametrize(
    ("right_bucket", "expected"),
    [("30m", FIXED_HALF_HOUR), ("1h", None), (None, None)],
)
def test_merging_only_preserves_an_agreed_period(
    right_bucket: str | None, expected: dict[str, object] | None
) -> None:
    operator, _ = registry.build("resample", {"bucket": "30m"})
    left = operator.run({"frame": sample_frame()})["frame"]
    right = sample_frame()
    if right_bucket is not None:
        operator, _ = registry.build("resample", {"bucket": right_bucket})
        right = operator.run({"frame": right})["frame"]
    assert isinstance(left, Frame)
    assert isinstance(right, Frame)
    for first, second in ((left, right), (right, left)):
        result = replace(
            first,
            provenance=merged_provenance(first.provenance, second.provenance),
        )
        assert preview.summarize(result)["data_period"] == expected
