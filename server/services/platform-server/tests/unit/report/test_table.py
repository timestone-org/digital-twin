"""表格原始行与汇总口径。"""

from datetime import UTC, datetime

import pytest

from platform_server.apps.dataset.services import ColumnSpec, EffectiveRow
from platform_server.apps.report.schemas.nodes import DataNodeSpec
from platform_server.apps.report.services.source import SourceData
from platform_server.apps.report.services.table import build_table


def test_raw_table_preserves_text_and_duplicate_timestamps():
    stamp = datetime(2026, 8, 1, tzinfo=UTC)
    found = SourceData(
        rows=(
            EffectiveRow(ts=stamp, source="manual", values={"value": "正常"}),
            EffectiveRow(ts=stamp, source="manual", values={"value": "停机"}),
        ),
        columns=(
            ColumnSpec(key="value", name="状态", data_type="text", unit=""),
        ),
        is_truncated=False,
    )
    result = build_table(found, DataNodeSpec(keys=["value"]), "UTC")
    assert [row[1] for row in result.rows] == ["正常", "停机"]


@pytest.mark.parametrize(
    ("bucket", "expected_count"),
    [("none", 3), ("hour", 2), ("day", 1), ("month", 1)],
)
def test_buckets_and_visible_summary(bucket, expected_count):
    found = SourceData(
        rows=tuple(
            EffectiveRow(
                ts=datetime(2026, 8, 1, hour, minute, tzinfo=UTC),
                source="manual",
                values={"value": value},
            )
            for hour, minute, value in [(1, 0, "1"), (1, 30, "3"), (2, 0, "8")]
        ),
        columns=(
            ColumnSpec(key="value", name="数值", data_type="number", unit=""),
        ),
        is_truncated=False,
    )
    spec = DataNodeSpec(
        keys=["value"],
        bucket=bucket,
        agg="sum",
        summary="sum",
        order="desc",
        time_format="date",
    )
    result = build_table(found, spec, "UTC")
    assert len(result.rows) == expected_count + 1
    assert result.rows[-1] == ["合计", "12.00"]


def test_table_truncation_keeps_newest_and_summarizes_only_visible():
    found = SourceData(
        rows=tuple(
            EffectiveRow(
                ts=datetime(2026, 8, day, tzinfo=UTC),
                source="manual",
                values={"value": str(day)},
            )
            for day in (1, 2, 3)
        ),
        columns=(
            ColumnSpec(key="value", name="数值", data_type="number", unit=""),
        ),
        is_truncated=False,
    )
    result = build_table(
        found, DataNodeSpec(keys=["value"], limit=2, summary="sum"), "UTC"
    )
    assert result.is_truncated
    assert result.rows[-1] == ["合计", "5.00"]


def test_unknown_table_column_rejected():
    found = SourceData(rows=(), columns=(), is_truncated=False)
    with pytest.raises(ValueError, match="台账列"):
        build_table(found, DataNodeSpec(keys=["unknown"]), "UTC")
