"""预测后处理：算子口径、图校验，以及发布件在线上真的走了这一步。"""

import math

import pytest
from pydantic import ValidationError

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    PredictionPostprocess,
    registry,
)
from platform_server.apps.modeling.operators.postprocess import UNTOUCHED_NOTE
from platform_server.apps.modeling.schemas.graph import PipelineGraph
from platform_server.apps.modeling.services.entry_contract import NodeRecord
from platform_server.apps.modeling.services.graph_check import check_graph
from platform_server.apps.modeling.services.publish_service import (
    Publishable,
    inspect_run,
)
from platform_server.apps.modeling.services.run_executor import execute_graph
from platform_server.apps.modeling.services.serving import compile_model
from unit.modeling_fakes import (
    DirectRunner,
    edge,
    execution_of,
    linear_frame,
    linear_graph,
    node,
)

# 模型在这一行上算出的数远小于 0：两个斜率都是正的
NEGATIVE_ROW = [-1000.0, -1000.0]
WRONG_SOURCE = "后处理只能接在回归模型"


def adjusted(
    code: str, config: dict[str, object], value: float
) -> float | None:
    """让一个算子改写一个数。

    Args: code, config, value。
    """
    operator, _ = registry.build(code, config)
    assert isinstance(operator, PredictionPostprocess)
    return operator.adjust_rows([value])[0]


def scored_frame() -> Frame:
    return Frame(
        columns=(
            FrameColumn(key="y_true", name="真实值", dtype="number"),
            FrameColumn(key="y_pred", name="预测值", dtype="number"),
        ),
        rows=((1.0, -2.0), (2.0, 3.0), (3.0, None)),
        index=(10, 20, 30),
    )


@pytest.mark.parametrize(
    ("config", "value", "expected"),
    [
        ({}, -0.5, 0.0),
        ({}, 7.0, 7.0),
        ({"lower": None, "upper": 5.0}, 7.0, 5.0),
        ({"lower": 1.0, "upper": 5.0}, 0.0, 1.0),
    ],
)
def test_clamp_keeps_a_prediction_inside_its_bounds(
    config: dict[str, object], value: float, expected: float
) -> None:
    assert adjusted("clamp_prediction", config, value) == expected


@pytest.mark.parametrize(
    "config",
    [{"lower": None, "upper": None}, {"lower": 5.0, "upper": 1.0}],
)
def test_clamp_refuses_bounds_that_mean_nothing(
    config: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        registry.build("clamp_prediction", config)


@pytest.mark.parametrize(
    ("op", "value", "expected"),
    [
        ("lt", 4.0, -1.0),
        ("lt", 5.0, 5.0),
        ("lte", 5.0, -1.0),
        ("gt", 6.0, -1.0),
        ("gte", 5.0, -1.0),
        ("eq", 5.0, -1.0),
        ("ne", 5.0, 5.0),
    ],
)
def test_replace_only_fires_when_the_condition_holds(
    op: str, value: float, expected: float
) -> None:
    config = {"op": op, "threshold": 5.0, "value": -1.0}
    assert adjusted("replace_prediction", config, value) == expected


@pytest.mark.parametrize(
    ("config", "value", "expected"),
    [
        ({}, 2.5, 3.0),
        ({"decimals": 2}, 1.005, 1.01),
        ({"mode": "floor"}, -0.5, -1.0),
        ({"mode": "ceil"}, 0.1, 1.0),
        ({}, 1e300, 1e300),
    ],
)
def test_round_uses_decimal_rounding(
    config: dict[str, object], value: float, expected: float
) -> None:
    assert adjusted("round_prediction", config, value) == expected


@pytest.mark.parametrize(
    "code", ["clamp_prediction", "replace_prediction", "round_prediction"]
)
def test_an_uncomputable_prediction_is_not_dressed_up(code: str) -> None:
    got = adjusted(code, {}, math.nan)
    assert got is not None
    assert math.isnan(got)


def test_only_the_prediction_column_changes() -> None:
    operator, _ = registry.build("clamp_prediction", {})
    made = operator.run({"scored": scored_frame()})["scored"]
    assert made.rows == ((1.0, 0.0), (2.0, 3.0), (3.0, None))
    assert made.index == (10, 20, 30)


def test_the_report_counts_the_values_it_changed() -> None:
    operator, _ = registry.build("clamp_prediction", {})
    operator.run({"scored": scored_frame()})
    block = operator.report()[0]
    assert block.payload["by_column"][0]["changed"] == 1
    assert block.payload["by_column"][0]["samples"] == [-2.0]


def test_nothing_changed_is_said_out_loud() -> None:
    operator, _ = registry.build("clamp_prediction", {"lower": -5.0})
    operator.run({"scored": scored_frame()})
    assert operator.report()[0].payload["notes"][0]["text"] == UNTOUCHED_NOTE


def test_a_report_before_running_or_without_numbers_stays_quiet() -> None:
    operator, _ = registry.build("clamp_prediction", {})
    assert operator.report() == ()
    empty = Frame(columns=scored_frame().columns, rows=((1.0, None),))
    operator.run({"scored": empty})
    assert [block.zone for block in operator.report()] == ["step"]


def graph_after(
    model: str, *extra: tuple[str, str], port: str = "scored"
) -> PipelineGraph:
    """模型下游挂若干后处理，全部接在同一个口上。

    Args: model, extra（节点 id 与算子码）, port。
    """
    base = linear_graph()
    nodes = [
        node(item.id, model) if item.id == "m" else item for item in base.nodes
    ]
    edges = list(base.edges)
    for seat, (node_id, code) in enumerate(extra):
        nodes.append(node(node_id, code))
        edges.append(edge(f"post{seat}", "m", port, node_id, "scored"))
    return PipelineGraph(nodes=nodes, edges=edges)


def test_a_linear_model_accepts_a_postprocess_chain() -> None:
    graph = chained_graph()
    assert check_graph(graph) == []


def test_a_classifier_cannot_take_a_postprocess() -> None:
    graph = graph_after("logistic_regression", ("c", "clamp_prediction"))
    messages = [issue.message for issue in check_graph(graph)]
    assert any(WRONG_SOURCE in message for message in messages)


def test_a_postprocess_cannot_sit_on_a_plain_frame() -> None:
    base = linear_graph()
    graph = PipelineGraph(
        nodes=[*base.nodes, node("c", "clamp_prediction")],
        edges=[*base.edges, edge("x", "p", "test", "c", "scored")],
    )
    assert [issue.node_id for issue in check_graph(graph)] == ["c"]


def test_one_scored_port_cannot_fork_into_two_chains() -> None:
    """并排两路在线上会先后都过一遍，算出的数与哪一路的评估都对不上。"""
    graph = graph_after(
        "linear_regression",
        ("c", "clamp_prediction"),
        ("r", "round_prediction"),
    )
    messages = [issue.message for issue in check_graph(graph)]
    assert any("只能接一条后处理链" in message for message in messages)


def test_a_cycle_of_postprocess_nodes_does_not_hang_the_check() -> None:
    base = linear_graph()
    graph = PipelineGraph(
        nodes=[
            *base.nodes,
            node("c", "clamp_prediction"),
            node("r", "round_prediction"),
        ],
        edges=[
            *base.edges,
            edge("x", "c", "scored", "r", "scored"),
            edge("y", "r", "scored", "c", "scored"),
        ],
    )
    assert check_graph(graph) != []


def chained_graph() -> PipelineGraph:
    """模型 → 限幅 → 取整 → 回归评估，带标准化，不摘风险点。"""
    base = linear_graph()
    return PipelineGraph(
        nodes=[
            *base.nodes,
            node("c", "clamp_prediction", upper=500.0),
            node("r", "round_prediction", decimals=1),
        ],
        edges=[
            *[item for item in base.edges if item.id != "e6"],
            edge("x1", "m", "scored", "c", "scored"),
            edge("x2", "c", "scored", "r", "scored"),
            edge("x3", "r", "scored", "e", "scored"),
        ],
    )


async def published(
    graph: PipelineGraph,
) -> tuple[Publishable, dict[str, NodeRecord]]:
    """真跑一遍图再判发布。

    Args: graph。
    """
    execution = execution_of(DirectRunner(), frames={"s": linear_frame(120)})
    outcome = await execute_graph(graph, execution=execution)
    records = {
        item.node_id: NodeRecord(
            preview=dict(item.preview), fitted=item.fitted, io=dict(item.io)
        )
        for item in outcome.nodes
    }
    return inspect_run(graph, records), records


async def test_a_published_model_postprocesses_its_prediction_online() -> None:
    """同一行：不带后处理是负数，带上之后是 0，单行与整批一致。

    ⚠ 先算一遍不带后处理的：夹具的预测值本来就不小于 0 的话这条恒绿。
    """
    raw, _ = await published(linear_graph())
    assert raw.is_servable is True, raw.reason
    raw_value = compile_model(raw.serving).predict(NEGATIVE_ROW)
    assert raw_value is not None
    assert raw_value < 0

    verdict, _ = await published(chained_graph())
    assert verdict.is_servable is True, verdict.reason
    compiled = compile_model(verdict.serving)
    assert compiled.predict(NEGATIVE_ROW) == 0.0
    assert compiled.predict_many([(NEGATIVE_ROW, None)]) == [0.0]


async def test_the_upper_bound_and_rounding_both_run_in_order() -> None:
    verdict, _ = await published(chained_graph())
    assert compile_model(verdict.serving).predict([1000.0, 1000.0]) == 500.0
    operators = [step["operator"] for step in verdict.serving["steps"]]
    assert operators[-3:] == [
        "linear_regression",
        "clamp_prediction",
        "round_prediction",
    ]


async def test_the_signature_tells_people_about_the_postprocess() -> None:
    verdict, _ = await published(chained_graph())
    assert [item["operator"] for item in verdict.signature["postprocess"]] == [
        "clamp_prediction",
        "round_prediction",
    ]


async def test_evaluation_downstream_scores_the_processed_prediction() -> None:
    """评估接在后处理之后，指标算的是处理后的数。"""
    _, plain = await published(linear_graph())
    _, processed = await published(chained_graph())
    assert (
        plain["e"].preview["metrics"]["metrics"]["rmse"]
        != processed["e"].preview["metrics"]["metrics"]["rmse"]
    )
