"""源帧对齐必须保留两路来源、截断及保守观测截止。"""

from datetime import UTC, datetime, timedelta, timezone

import pytest

from platform_server.apps.modeling.operators import Frame, FrameColumn, registry
from platform_server.apps.modeling.operators.frame import Provenance
from platform_server.apps.modeling.services.preview import summarize

DAY = datetime(2026, 1, 3, tzinfo=UTC)


def joined(left: Provenance, right: Provenance) -> Frame:
    moment = int(DAY.timestamp() * 1000)
    columns = (FrameColumn(key="value", name="读数", dtype="number"),)
    first = Frame(
        columns=columns, rows=((1.0,),), index=(moment,), provenance=left
    )
    second = Frame(
        columns=columns, rows=((2.0,),), index=(moment,), provenance=right
    )
    operator, _ = registry.build("ledger_join", {"tolerance_ms": 0})
    result = operator.run({"left": first, "right": second})["frame"]
    assert isinstance(result, Frame)
    assert result.rows == ((1.0, 2.0),)
    return result


def test_join_preserves_both_source_windows_and_right_truncation() -> None:
    left = Provenance(
        table_codes=("left", "shared"),
        since=DAY - timedelta(days=1),
        until=DAY + timedelta(days=1),
        observed_until=DAY + timedelta(days=1),
    )
    right = Provenance(
        table_codes=("right", "shared"),
        since=DAY - timedelta(days=2),
        until=DAY + timedelta(days=2),
        observed_until=DAY,
        is_truncated=True,
    )
    result = joined(left, right)
    assert result.provenance.table_codes == ("left", "shared", "right")
    assert result.provenance.since == datetime(2026, 1, 1, tzinfo=UTC)
    assert result.provenance.until == datetime(2026, 1, 5, tzinfo=UTC)
    assert result.provenance.observed_until == DAY
    assert result.provenance.is_truncated is True
    assert summarize(result)["provenance"]["is_truncated"] is True


@pytest.mark.parametrize(
    ("left", "right", "expected"),
    [
        (DAY, None, None),
        (None, DAY, None),
        (None, None, None),
        (DAY, DAY + timedelta(hours=1), DAY),
    ],
)
def test_unknown_observed_cutoff_on_either_source_is_not_invented(
    left: datetime | None, right: datetime | None, expected: datetime | None
) -> None:
    result = joined(
        Provenance(observed_until=left), Provenance(observed_until=right)
    )
    assert result.provenance.observed_until == expected


def test_window_union_compares_aware_instants_across_offsets() -> None:
    other_timezone = timezone(timedelta(hours=8))
    right = Provenance(
        since=(DAY - timedelta(hours=1)).astimezone(other_timezone),
        until=(DAY + timedelta(hours=1)).astimezone(other_timezone),
        observed_until=DAY.astimezone(other_timezone),
    )
    result = joined(Provenance(since=DAY, until=DAY, observed_until=DAY), right)
    assert result.provenance.since == DAY - timedelta(hours=1)
    assert result.provenance.until == DAY + timedelta(hours=1)
    assert result.provenance.observed_until == DAY
