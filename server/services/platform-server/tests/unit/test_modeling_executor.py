"""执行引擎的用例：跑通、失败即停、取消在节点边界、逐节点落库。

⚠ 引擎不认识进程池也不认识数据库，用例注入一个进程内的假跑法与两个假回调
就能验完整套状态机——这是把三件协作件做成注入项换来的。
"""

import json

import pytest

from platform_server.apps.modeling.operators import Frame, FrameColumn
from platform_server.apps.modeling.schemas.graph import (
    GraphEdge,
    PipelineGraph,
)
from platform_server.apps.modeling.services.preview import (
    RUN_PREVIEW_MAX_BYTES,
)
from platform_server.apps.modeling.services.run_executor import (
    TIMEOUT_REASON,
    NodeOutcome,
    RunOutcome,
    execute_graph,
)
from unit.modeling_fakes import (
    INTERCEPT,
    PERSISTED,
    SLOPE_LOAD,
    SLOPE_TEMP,
    BoomRunner,
    DirectRunner,
    execution_of,
    linear_frame,
    linear_graph,
    node,
)


async def run_linear(rows: int = 200) -> RunOutcome:
    """跑一遍最小闭环。

    Args: rows。
    """
    execution = execution_of(DirectRunner(), frames={"s": linear_frame(rows)})
    return await execute_graph(linear_graph(), execution=execution)


async def test_the_minimal_pipeline_runs_end_to_end() -> None:
    """六个节点全部成功，每个节点都留下了结果摘要。"""
    outcome = await run_linear()
    assert outcome.status == "succeeded"
    assert [item.status for item in outcome.nodes] == ["succeeded"] * 6
    assert all(item.preview for item in outcome.nodes)


async def test_every_node_is_persisted_as_it_finishes() -> None:
    """逐节点落库，不是攒到最后一次性写。

    ⚠ 攒到最后的话，一次长运行在界面上会一直显示零进度，而它其实跑了大半。
    """
    execution = execution_of(DirectRunner(), frames={"s": linear_frame(50)})
    await execute_graph(linear_graph(), execution=execution)
    assert len(PERSISTED[id(execution)]) == 6


async def test_the_run_reports_the_source_facts() -> None:
    """取数的两个第一手事实要如实往上传。"""
    outcome = await run_linear(150)
    assert outcome.row_count == 150
    assert outcome.is_source_truncated is False


async def test_previews_are_dispatched_by_kind() -> None:
    """每种负载的摘要都带 `kind`，前端按它显式派发而不是嗅探结构。"""
    kinds = {
        port: preview["kind"]
        for item in (await run_linear(50)).nodes
        for port, preview in item.preview.items()
    }
    assert kinds["frame"] == "frame"
    assert kinds["model"] == "model"
    assert kinds["metrics"] == "metrics"


async def test_the_model_preview_carries_the_true_coefficients() -> None:
    """整条链路跑下来，模型摘要里的系数就是造数时那三个。"""
    execution = execution_of(DirectRunner(), frames={"s": linear_frame(100)})
    outcome = await execute_graph(_without_standardize(), execution=execution)
    fitted = _preview_of(outcome, "linear_regression", "model")["fitted"]
    assert fitted["coef"]["温度"] == pytest.approx(SLOPE_TEMP)
    assert fitted["coef"]["负荷"] == pytest.approx(SLOPE_LOAD)
    assert fitted["intercept"] == pytest.approx(INTERCEPT)


async def test_every_fitting_step_hands_back_what_it_learned() -> None:
    """带拟合的算子学到的东西必须跟着记录回来，不能留在子进程里。

    ⚠ 这一条盯的是一条真出过的缺陷：拟合参数曾经只在**建模**那一步的摘要里
    有，填缺失与标准化两步的一个字都没落下来，于是推理期拿单行重新拟合
    （docs/MODELING_PLATFORM_DESIGN.md 缺陷 A）。
    """
    outcome = await run_linear(100)
    fills = _node_of(outcome, "fill_missing").fitted or {}
    scales = _node_of(outcome, "standardize").fitted or {}
    assert sorted(fills) == ["温度", "负荷"]
    assert sorted(scales) == ["温度", "负荷"]
    assert all(item["scale"] > 0 for item in scales.values()), scales
    assert _node_of(outcome, "split_dataset").fitted is None


async def test_each_step_records_the_columns_it_actually_saw() -> None:
    """逐端口的真实列集要记下来，发布时的输入契约按它算（D3）。"""
    outcome = await run_linear(100)
    standardize = _node_of(outcome, "standardize").io
    assert standardize["inputs"]["frame"] == ["温度", "负荷", "能耗"]
    assert standardize["outputs"]["frame"] == ["温度", "负荷", "能耗"]
    split = _node_of(outcome, "split_dataset").io
    assert sorted(split["outputs"]) == ["test", "train"]


async def test_a_failing_node_stops_the_run_and_skips_the_rest() -> None:
    """失败即停：失败的那个落 failed，其余**显式**落 skipped，序号接着排。"""
    graph = linear_graph()
    graph.nodes[3].config = {"target_column": "没有这一列"}
    execution = execution_of(DirectRunner(), frames={"s": linear_frame(50)})
    outcome = await execute_graph(graph, execution=execution)
    assert outcome.status == "failed"
    assert [item.status for item in outcome.nodes] == ["succeeded"] * 3 + [
        "failed"
    ] + ["skipped"] * 2
    assert [item.ordinal for item in outcome.nodes] == [0, 1, 2, 3, 4, 5]


async def test_skipped_nodes_are_persisted_too() -> None:
    """跳过的节点也要落库——留空的话界面分不清「没跑」与「记录丢了」。"""
    graph = linear_graph()
    graph.nodes[3].config = {"target_column": "没有这一列"}
    execution = execution_of(DirectRunner(), frames={"s": linear_frame(50)})
    await execute_graph(graph, execution=execution)
    statuses = [item.status for item in PERSISTED[id(execution)]]
    assert statuses.count("skipped") == 2


async def test_the_failure_reason_is_human_readable() -> None:
    """算子自己判定得出的错误原样透给用户，不带 traceback。"""
    graph = linear_graph()
    graph.nodes[3].config = {"target_column": "没有这一列"}
    execution = execution_of(DirectRunner(), frames={"s": linear_frame(50)})
    outcome = await execute_graph(graph, execution=execution)
    assert outcome.error_text == "上游数据里没有列「没有这一列」"


async def test_a_timeout_becomes_a_readable_node_failure() -> None:
    """超时被掐断时给一句人话，不是一坨 traceback。"""
    execution = execution_of(
        BoomRunner(on="standardize", error=TimeoutError()),
        frames={"s": linear_frame(50)},
    )
    outcome = await execute_graph(linear_graph(), execution=execution)
    assert outcome.status == "failed"
    assert outcome.error_text == TIMEOUT_REASON


async def test_a_source_failure_becomes_that_node_failing() -> None:
    """取数取不到时是**那个源节点**失败，不是整条链路无声消失。"""
    execution = execution_of(DirectRunner(), failures={"s": "台账不存在"})
    outcome = await execute_graph(linear_graph(), execution=execution)
    assert outcome.status == "failed"
    assert outcome.nodes[0].status == "failed"
    assert outcome.error_text == "台账不存在"


async def test_cancelling_stops_at_the_next_node_boundary() -> None:
    """取消在**下一个节点边界**生效，剩下的显式落 skipped。"""
    execution = execution_of(
        DirectRunner(), frames={"s": linear_frame(50)}, cancel_after=2
    )
    outcome = await execute_graph(linear_graph(), execution=execution)
    assert outcome.status == "cancelled"
    assert [item.status for item in outcome.nodes] == ["succeeded"] * 2 + [
        "skipped"
    ] * 4


async def test_run_previews_stay_within_the_budget() -> None:
    """一次运行的全部摘要合计不超过预算。"""
    total = sum(
        len(json.dumps(item.preview, ensure_ascii=False).encode())
        for item in (await run_linear(500)).nodes
    )
    assert total <= RUN_PREVIEW_MAX_BYTES


async def test_a_frame_preview_reports_column_statistics() -> None:
    """帧摘要里每列都带空值率与四个统计量。"""
    frame = Frame(
        columns=(FrameColumn(key="温度", name="温度", dtype="number"),),
        rows=((1.0,), (None,), (3.0,)),
    )
    execution = execution_of(DirectRunner(), frames={"s": frame})
    outcome = await execute_graph(_source_only(), execution=execution)
    stat = outcome.nodes[0].preview["frame"]["columns"][0]
    assert stat["null_ratio"] > 0
    assert stat["min"] == 1.0
    assert stat["max"] == 3.0


def _without_standardize() -> PipelineGraph:
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


def _source_only() -> PipelineGraph:
    """只有一个取数节点的图。"""
    return PipelineGraph(
        nodes=[node("s", "ledger_source", table_code="energy_h")]
    )


def _preview_of(
    outcome: RunOutcome, operator: str, port: str
) -> dict[str, object]:
    """从运行结果里取某个算子某个端口的摘要。

    Args: outcome, operator, port。
    """
    return _node_of(outcome, operator).preview[port]


def _node_of(outcome: RunOutcome, operator: str) -> NodeOutcome:
    """从运行结果里取某个算子那一条记录。

    Args: outcome, operator。
    """
    for item in outcome.nodes:
        if item.operator == operator:
            return item
    raise AssertionError(f"运行里没有 {operator} 这个节点")
