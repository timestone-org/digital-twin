"""每日建模的数据准备：显式选列、分别汇总、缺失传播和完整时间桶。"""

from dataclasses import replace
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    OperatorError,
    Provenance,
    registry,
)
from platform_server.apps.modeling.schemas.graph import PipelineGraph
from platform_server.apps.modeling.services.graph_check import check_graph
from unit.modeling_fakes import edge, node

HOUR = 3_600_000
DAY = 24 * HOUR
START = 16 * HOUR


def production_frame() -> Frame:
    return Frame(
        columns=(
            FrameColumn(key="产量", name="计划产量", dtype="number", unit="吨"),
            FrameColumn(key="温度", name="温度", dtype="number", unit="℃"),
            FrameColumn(key="工单", name="工单编号", dtype="string"),
            FrameColumn(
                key="能耗", name="实际能耗", dtype="number", unit="kWh"
            ),
        ),
        rows=((10.0, 20.0, "A", 30.0), (15.0, 30.0, "B", 40.0)),
        index=(START, START + HOUR),
        provenance=Provenance(
            table_codes=("production",),
            since=datetime.fromtimestamp(START / 1000, UTC),
            until=datetime.fromtimestamp((START + DAY) / 1000, UTC),
        ),
    )


def run_frame(code: str, frame: Frame, **config: object) -> Frame:
    operator, _ = registry.build(code, config)
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    result = operator.run({"frame": frame})["frame"]
    assert isinstance(result, Frame)
    return result


def test_columns_are_selected_in_configured_order_with_metadata() -> None:
    source = production_frame()
    result = run_frame("select_columns", source, columns=["能耗", "产量"])
    assert result.keys == ("能耗", "产量")
    assert result.rows == ((30.0, 10.0), (40.0, 15.0))
    assert result.columns[0].unit == "kWh"
    assert (result.index, result.provenance) == (
        source.index,
        source.provenance,
    )


@pytest.mark.parametrize("columns", [[], ["产量", "产量"], [""]])
def test_selection_rejects_empty_or_duplicate_keys(columns: list[str]) -> None:
    with pytest.raises(ValidationError):
        registry.build("select_columns", {"columns": columns})


def test_selection_rejects_missing_columns() -> None:
    with pytest.raises(OperatorError, match=r"不存在|没有列"):
        run_frame("select_columns", production_frame(), columns=["不存在"])


def test_selection_describes_its_output_and_reports_removed_columns() -> None:
    operator, config = registry.build("select_columns", {"columns": ["产量"]})
    assert operator.report() == ()
    operator.run({"frame": production_frame()})
    assert operator.describe_columns(config, {"frame": None}) == {
        "frame": ("产量",)
    }
    assert operator.report()[0].payload["removed"] == ["温度", "工单", "能耗"]


def test_daily_columns_use_separate_aggregations() -> None:
    result = run_frame(
        "resample",
        production_frame(),
        bucket="1d",
        agg="sum",
        column_aggregations={"温度": "avg", "工单": "count"},
    )
    assert result.rows == ((25.0, 25.0, 2.0, 70.0),)
    assert result.index == (START,)
    assert result.column_of("工单").dtype == "number"
    assert result.column_of("工单").unit == ""


def test_numeric_count_has_no_original_unit() -> None:
    result = run_frame("resample", production_frame(), agg="count")
    assert result.column_of("产量").unit == ""


def test_partial_missing_energy_stays_unknown_when_requested() -> None:
    source = replace(
        production_frame(),
        rows=((10.0, 20.0, "A", 30.0), (15.0, None, "B", None)),
    )
    result = run_frame(
        "resample", source, bucket="1d", agg="sum", missing_policy="propagate"
    )
    assert result.rows == ((25.0, None, "B", None),)
    assert run_frame("resample", source, bucket="1d", agg="sum").values_of(
        "能耗"
    ) == [30.0]


@pytest.mark.parametrize("rule", [{"不存在": "sum"}, {"工单": "avg"}])
def test_invalid_column_aggregation_is_rejected(rule: dict[str, str]) -> None:
    with pytest.raises(OperatorError, match=r"不存在|没有列|数值"):
        run_frame("resample", production_frame(), column_aggregations=rule)


def test_unknown_aggregation_is_not_accepted() -> None:
    with pytest.raises(ValidationError):
        registry.build("resample", {"column_aggregations": {"产量": "median"}})


@pytest.mark.parametrize(
    ("method", "expected"), [("first", "A"), ("last", "B"), ("count", 2.0)]
)
def test_text_columns_have_explicit_first_last_and_count(
    method: str, expected: str | float
) -> None:
    result = run_frame(
        "resample",
        production_frame(),
        bucket="1d",
        column_aggregations={"工单": method},
    )
    assert result.values_of("工单") == [expected]


def test_missing_count_can_be_kept_unknown_and_empty_first_stays_empty() -> (
    None
):
    source = replace(
        production_frame(), rows=((0.0, None, None, None),), index=(START,)
    )
    unknown = run_frame(
        "resample",
        source,
        column_aggregations={"工单": "count"},
        missing_policy="propagate",
    )
    assert unknown.values_of("工单") == [None]
    assert run_frame(
        "resample", source, column_aggregations={"工单": "first"}
    ).values_of("工单") == [None]


def test_rule_count_is_bounded() -> None:
    with pytest.raises(ValidationError):
        registry.build(
            "resample",
            {
                "column_aggregations": {
                    str(index): "sum" for index in range(257)
                }
            },
        )


def test_boundary_exclusions_are_visible_in_the_result_report() -> None:
    source = production_frame()
    source = replace(
        source,
        provenance=replace(
            source.provenance,
            until=datetime.fromtimestamp((START + HOUR) / 1000, UTC),
        ),
    )
    operator, _ = registry.build(
        "resample", {"bucket": "1d", "should_keep_complete_buckets": True}
    )
    operator.run({"frame": source})
    assert operator.report()[0].payload["dropped"] == 2
    assert operator.report()[0].payload["after"] == 0


def test_column_rules_are_checked_before_running() -> None:
    graph = PipelineGraph(
        nodes=[
            node("s", "ledger_source", table_code="orders", columns=["产量"]),
            node("a", "resample", column_aggregations={"错列": "sum"}),
        ],
        edges=[edge("e", "s", "frame", "a", "frame")],
    )
    assert any(
        "错列" in issue.message and issue.node_id == "a"
        for issue in check_graph(graph)
    )


def test_only_fully_covered_business_days_are_kept() -> None:
    source = production_frame()
    source = replace(
        source,
        rows=source.rows * 3,
        index=(
            START,
            START + HOUR,
            START + DAY,
            START + DAY + HOUR,
            START + 2 * DAY,
            START + 2 * DAY + HOUR,
        ),
        provenance=replace(
            source.provenance,
            since=datetime.fromtimestamp((START + HOUR) / 1000, UTC),
            until=datetime.fromtimestamp((START + 2 * DAY + HOUR) / 1000, UTC),
        ),
    )
    result = run_frame(
        "resample",
        source,
        bucket="1d",
        agg="sum",
        should_keep_complete_buckets=True,
    )
    assert result.index == (START + DAY,)
    assert result.values_of("能耗") == [70.0]


def test_a_complete_day_including_its_zero_production_is_kept() -> None:
    source = replace(
        production_frame(), rows=((0.0, 20.0, None, 5.0),), index=(START,)
    )
    result = run_frame(
        "resample",
        source,
        bucket="1d",
        agg="sum",
        should_keep_complete_buckets=True,
    )
    assert result.values_of("产量") == [0.0]
    assert result.values_of("能耗") == [5.0]


def test_complete_buckets_still_respect_a_query_that_ended_before_reading() -> (
    None
):
    original = production_frame()
    source = replace(
        original,
        provenance=replace(
            original.provenance,
            until=datetime.fromtimestamp((START + HOUR) / 1000, UTC),
            observed_until=datetime.fromtimestamp((START + DAY) / 1000, UTC),
        ),
    )
    result = run_frame(
        "resample", source, bucket="1d", should_keep_complete_buckets=True
    )
    assert result.rows == ()


@pytest.mark.parametrize("earlier_side", ["left", "right"])
def test_join_keeps_the_earliest_observation_cutoff(earlier_side: str) -> None:
    source = production_frame()
    early = replace(
        source,
        provenance=replace(
            source.provenance,
            observed_until=datetime.fromtimestamp((START + HOUR) / 1000, UTC),
        ),
    )
    later = replace(
        source,
        provenance=replace(
            source.provenance,
            observed_until=datetime.fromtimestamp((START + DAY) / 1000, UTC),
        ),
    )
    inputs = {"left": later, "right": later, earlier_side: early}
    join, _ = registry.build("ledger_join", {"tolerance_ms": 0})
    joined = join.run(inputs)["frame"]
    assert isinstance(joined, Frame)
    result = run_frame(
        "resample", joined, bucket="1d", should_keep_complete_buckets=True
    )
    assert result.rows == ()


@pytest.mark.parametrize(
    "provenance",
    [Provenance(), replace(production_frame().provenance, is_truncated=True)],
)
def test_complete_buckets_require_a_known_untruncated_window(
    provenance: Provenance,
) -> None:
    with pytest.raises(OperatorError, match=r"窗口|上限"):
        run_frame(
            "resample",
            replace(production_frame(), provenance=provenance),
            should_keep_complete_buckets=True,
        )
