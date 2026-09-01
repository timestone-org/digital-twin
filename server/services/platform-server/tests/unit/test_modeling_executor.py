"""执行引擎的用例：跑通、失败即停、上下文按端口取。"""

import json

from platform_server.apps.modeling.operators import Frame, FrameColumn
from platform_server.apps.modeling.schemas.graph import (
    GraphEdge,
    PipelineGraph,
)
from platform_server.apps.modeling.services.preview import (
    RUN_PREVIEW_MAX_BYTES,
)
from platform_server.apps.modeling.services.run_executor import execute_graph
from unit.modeling_fakes import (
    INTERCEPT,
    SLOPE_LOAD,
    SLOPE_TEMP,
    linear_frame,
    linear_graph,
    node,
)


def run_linear(rows: int = 200):
    """跑一遍最小闭环。

    Args: rows。
    """
    return execute_graph(
        linear_graph(),
        prefetched={"s": linear_frame(rows)},
        tz_offset_minutes=480,
    )


def test_the_minimal_pipeline_runs_end_to_end() -> None:
    """六个节点全部成功，每个节点都留下了结果摘要。"""
    outcome = run_linear()
    assert outcome.status == "succeeded"
    assert [node.status for node in outcome.nodes] == ["succeeded"] * 6
    assert all(node.preview for node in outcome.nodes)


def test_the_run_reports_the_source_facts() -> None:
    """取数的两个第一手事实要如实往上传。"""
    outcome = run_linear(150)
    assert outcome.row_count == 150
    assert outcome.is_source_truncated is False


def test_previews_are_dispatched_by_kind() -> None:
    """每种负载的摘要都带 `kind`，前端按它显式派发而不是嗅探结构。"""
    kinds = {
        port: preview["kind"]
        for node in run_linear(50).nodes
        for port, preview in node.preview.items()
    }
    assert kinds["frame"] == "frame"
    assert kinds["model"] == "model"
    assert kinds["metrics"] == "metrics"


def test_the_model_preview_carries_the_true_coefficients() -> None:
    """整条链路跑下来，模型摘要里的系数就是造数时那三个。"""
    outcome = execute_graph(
        _without_standardize(),
        prefetched={"s": linear_frame(100)},
        tz_offset_minutes=480,
    )
    fitted = _preview_of(outcome, "linear_regression", "model")["fitted"]
    assert round(fitted["coef"]["温度"], 6) == SLOPE_TEMP
    assert round(fitted["coef"]["负荷"], 6) == SLOPE_LOAD
    assert round(fitted["intercept"], 6) == INTERCEPT


def test_a_failing_node_stops_the_run_and_skips_the_rest() -> None:
    """失败即停：失败的那个落 failed，其余**显式**落 skipped，序号接着排。"""
    graph = linear_graph()
    graph.nodes[3].config = {"target_column": "没有这一列"}
    outcome = execute_graph(
        graph, prefetched={"s": linear_frame(50)}, tz_offset_minutes=480
    )
    assert outcome.status == "failed"
    statuses = [node.status for node in outcome.nodes]
    assert statuses == ["succeeded"] * 3 + ["failed"] + ["skipped"] * 2
    assert [node.ordinal for node in outcome.nodes] == [0, 1, 2, 3, 4, 5]


def test_the_failure_reason_is_human_readable() -> None:
    """算子自己判定得出的错误原样透给用户，不带 traceback。"""
    graph = linear_graph()
    graph.nodes[3].config = {"target_column": "没有这一列"}
    outcome = execute_graph(
        graph, prefetched={"s": linear_frame(50)}, tz_offset_minutes=480
    )
    assert outcome.error_text == "上游数据里没有列「没有这一列」"


def test_a_source_without_data_fails_loudly() -> None:
    """引擎没给取数节点准备数据时整条运行失败，而不是算出一堆空。"""
    outcome = execute_graph(
        linear_graph(), prefetched={}, tz_offset_minutes=480
    )
    assert outcome.status == "failed"
    assert outcome.nodes[0].status == "failed"


def test_run_previews_stay_within_the_budget() -> None:
    """一次运行的全部摘要合计不超过预算。"""
    total = sum(
        len(json.dumps(node.preview, ensure_ascii=False).encode())
        for node in run_linear(500).nodes
    )
    assert total <= RUN_PREVIEW_MAX_BYTES


def _without_standardize():
    """去掉标准化那一步，让系数留在原始尺度上便于手算核对。"""
    graph = linear_graph()
    graph.nodes = [item for item in graph.nodes if item.id != "z"]
    graph.edges = [edge for edge in graph.edges if edge.id not in {"e2", "e3"}]
    graph.edges.append(
        GraphEdge(
            id="relink",
            from_node="f",
            from_port="frame",
            to_node="p",
            to_port="frame",
        )
    )
    return graph


def _preview_of(outcome, operator: str, port: str) -> dict[str, object]:
    """从运行结果里取某个算子某个端口的摘要。

    Args: outcome, operator, port。
    """
    for item in outcome.nodes:
        if item.operator == operator:
            return item.preview[port]
    raise AssertionError(f"运行里没有 {operator} 这个节点")


def test_a_frame_preview_reports_column_statistics() -> None:
    """帧摘要里每列都带空值率与四个统计量。"""
    frame = Frame(
        columns=(FrameColumn(key="温度", name="温度", dtype="number"),),
        rows=((1.0,), (None,), (3.0,)),
    )
    outcome = execute_graph(
        _source_only(), prefetched={"s": frame}, tz_offset_minutes=480
    )
    stat = outcome.nodes[0].preview["frame"]["columns"][0]
    assert stat["null_ratio"] > 0
    assert stat["min"] == 1.0
    assert stat["max"] == 3.0


def _source_only() -> PipelineGraph:
    """只有一个取数节点的图。"""
    return PipelineGraph(
        nodes=[node("s", "ledger_source", table_code="energy_h")]
    )
