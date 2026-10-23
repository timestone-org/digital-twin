"""结果摘要的中位数、截断状态和分类概率必须符合结果含义。"""

import pytest

from platform_server.apps.modeling.operators import Frame, FrameColumn, registry
from platform_server.apps.modeling.operators.frame import (
    select_rows,
    with_column_values,
    with_roles,
)
from platform_server.apps.modeling.schemas.graph import (
    GraphEdge,
    GraphNode,
    PipelineGraph,
)
from platform_server.apps.modeling.services import preview
from platform_server.apps.modeling.services.graph_check import check_graph
from unit.test_modeling_classification_curves import (
    items_of,
    ran,
    scored,
    stat_of,
)


@pytest.mark.parametrize(
    ("values", "expected"),
    [((1.0, 9.0), 5.0), ((1.0, 3.0, 8.0, 10.0), 5.5), ((3.0,), 3.0)],
)
def test_preview_p50_is_the_interpolated_median(
    values: tuple[float, ...], expected: float
) -> None:
    frame = Frame(
        columns=(FrameColumn(key="能耗", name="能耗", dtype="number"),),
        rows=tuple((value,) for value in values),
    )
    summary = preview.summarize(frame)
    assert summary["columns"][0]["p50"] == expected


def test_column_only_truncation_is_reported_as_preview_truncation() -> None:
    frame = Frame(
        columns=tuple(
            FrameColumn(key=f"c{seat}", name=f"列{seat}", dtype="number")
            for seat in range(preview.PREVIEW_COLS + 1)
        ),
        rows=(tuple(1.0 for _ in range(preview.PREVIEW_COLS + 1)),),
    )
    summary, truncated = preview.fit_budget(preview.summarize(frame))
    assert summary["cols_truncated"] is True
    assert summary["rows_truncated"] is False
    assert truncated is True


def test_changing_the_positive_class_changes_probability_orientation() -> None:
    frame = scored(
        (
            (0.0, 0.0, 0.1),
            (0.0, 0.0, 0.2),
            (1.0, 1.0, 0.8),
            (1.0, 1.0, 0.9),
        )
    )
    blocks = ran(frame, positive_label=0.0).report()
    assert stat_of(blocks, "auc") == 1.0
    assert stat_of(blocks, "average_precision") == 1.0


@pytest.mark.parametrize("labels", [(0.0, 1.0), (-2.0, -1.0)])
def test_a_single_class_evaluation_uses_the_model_probability_label(
    labels: tuple[float, float],
) -> None:
    columns = (
        FrameColumn(key="x", name="特征", dtype="number"),
        FrameColumn(key="y", name="类目", dtype="number", role="target"),
    )
    train = Frame(
        columns=columns,
        rows=tuple(
            (value, labels[0] if value < 0 else labels[1])
            for value in (-3.0, -2.0, -1.0, 1.0, 2.0, 3.0)
        ),
    )
    test = Frame(columns=columns, rows=((-2.0, labels[0]),))
    model, _ = registry.build("logistic_regression", {})
    model.bind_runtime(tz_offset_minutes=0, split_plan=None)
    output = model.run({"train": train, "test": test})["scored"]
    assert isinstance(output, Frame)
    source_probability = output.values_of("y_proba")[0]
    assert isinstance(source_probability, float)
    output = with_column_values(output, "y_proba", [source_probability])
    output = select_rows(with_roles(output, target_key="y_true"), [0])
    select, _ = registry.build("select_columns", {"columns": list(output.keys)})
    output = select.run({"frame": output})["frame"]
    assert isinstance(output, Frame)
    assert output.column_of("y_proba").probability_classes == labels
    evaluation = ran(output, positive_label=labels[0]).report()
    observed = items_of(evaluation, "校准曲线")[0]["predicted"]
    assert observed == pytest.approx(1.0 - source_probability)


def test_a_single_class_without_probability_metadata_does_not_guess() -> None:
    frame = scored(((1.0, 1.0, 0.8),), has_class_metadata=False)
    blocks = ran(frame).report()
    titles = [block.title for block in blocks]
    assert "校准曲线" not in titles
    assert "阈值网格" not in titles


def test_two_observed_classes_can_orient_a_legacy_probability_column() -> None:
    frame = scored(((0.0, 0.0, 0.1), (1.0, 1.0, 0.9)), has_class_metadata=False)
    assert stat_of(ran(frame, positive_label=0.0).report(), "auc") == 1.0


@pytest.mark.parametrize("probability", [-0.1, 1.1])
def test_out_of_range_probabilities_are_not_drawn_as_valid_curves(
    probability: float,
) -> None:
    frame = scored(((0.0, 0.0, probability), (1.0, 1.0, 0.9)))
    titles = [block.title for block in ran(frame).report()]
    assert "校准曲线" not in titles
    assert "ROC 曲线" not in titles


def test_all_negative_predictions_have_a_matching_threshold_grid_tick() -> None:
    frame = scored(((0.0, 0.0, 0.1), (1.0, 0.0, 0.4)))
    grid = next(
        block for block in ran(frame).report() if block.title == "阈值网格"
    )
    baseline = grid.payload["baseline"]
    marked = next(
        (
            item
            for item in grid.payload["items"]
            if item["threshold"] == baseline
        ),
        None,
    )
    assert marked is not None
    assert marked["name"] == "全判负类"
    assert (marked["tp"], marked["fp"], marked["tn"], marked["fn"]) == (
        0,
        0,
        1,
        1,
    )


def test_the_all_negative_tick_is_kept_within_the_grid_budget() -> None:
    rows = tuple(
        (float(seat % 2), 0.0, (seat + 1) / 201) for seat in range(200)
    )
    grid = next(
        block
        for block in ran(scored(rows)).report()
        if block.title == "阈值网格"
    )
    assert len(grid.payload["items"]) == 59
    marked = next(
        item for item in grid.payload["items"] if item["name"] == "全判负类"
    )
    assert marked["threshold"] == grid.payload["baseline"]
    assert (marked["tp"], marked["fp"], marked["tn"], marked["fn"]) == (
        0,
        0,
        100,
        100,
    )


def test_the_all_negative_tick_can_sit_above_probability_one() -> None:
    frame = scored(((0.0, 1.0, 0.0), (1.0, 1.0, 0.0)))
    grid = next(
        block
        for block in ran(frame, positive_label=0.0).report()
        if block.title == "阈值网格"
    )
    marked = next(
        item for item in grid.payload["items"] if item["name"] == "全判负类"
    )
    assert marked["threshold"] > 1.0
    assert marked["tp"] == marked["fp"] == 0


@pytest.mark.parametrize("lag", [0, 101])
def test_lag_bounds_produce_a_field_validation_error(
    lag: int,
) -> None:
    graph = PipelineGraph(
        nodes=[
            GraphNode(
                id="source",
                operator="ledger_source",
                config={"table_code": "energy", "columns": ["能耗"]},
            ),
            GraphNode(
                id="lag",
                operator="lag_feature",
                config={"columns": ["能耗"], "lags": [lag]},
            ),
        ],
        edges=[
            GraphEdge(
                id="source-lag",
                from_node="source",
                from_port="frame",
                to_node="lag",
                to_port="frame",
            )
        ],
    )
    issues = check_graph(graph)
    assert len(issues) == 1
    assert issues[0].node_id == "lag"
