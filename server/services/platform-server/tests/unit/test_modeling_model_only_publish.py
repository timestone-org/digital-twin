"""模型作为推理链入口时，发布件保留训练契约并能正确预测。"""

from dataclasses import replace

import pytest

from platform_server.apps.modeling.schemas.graph import PipelineGraph
from platform_server.apps.modeling.services.entry_contract import NodeRecord
from platform_server.apps.modeling.services.publish_service import inspect_run
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


async def _run() -> tuple[PipelineGraph, dict[str, NodeRecord]]:
    graph = linear_graph()
    graph.nodes = [item for item in graph.nodes if item.id not in {"f", "z"}]
    graph.nodes.insert(1, node("d", "drop_missing"))
    graph.edges = [
        item for item in graph.edges if item.id not in {"e1", "e2", "e3"}
    ]
    graph.edges.extend(
        [
            edge("sd", "s", "frame", "d", "frame"),
            edge("dp", "d", "frame", "p", "frame"),
        ]
    )
    outcome = await execute_graph(
        graph,
        execution=execution_of(DirectRunner(), frames={"s": linear_frame(120)}),
    )
    return graph, {
        item.node_id: NodeRecord(
            preview=dict(item.preview), fitted=item.fitted, io=dict(item.io)
        )
        for item in outcome.nodes
    }


async def test_model_only_serving_uses_the_training_input_contract() -> None:
    graph, records = await _run()
    verdict = inspect_run(graph, records)

    assert verdict.is_servable is True, verdict.reason
    assert [item["key"] for item in verdict.signature["inputs"]] == [
        "温度",
        "负荷",
    ]
    assert verdict.signature["inputs"][0]["label"] == "环境温度"
    assert verdict.signature["inputs"][0]["unit"] == "℃"
    assert verdict.signature["inputs"][0]["training_stats"]["max"] > 20
    assert compile_model(verdict.serving).predict(
        [25.0, 430.0]
    ) == pytest.approx(1345.0)


async def test_missing_training_columns_keeps_model_identity() -> None:
    graph, records = await _run()
    records["m"] = replace(records["m"], io={})
    verdict = inspect_run(graph, records)

    assert verdict.is_servable is False
    assert "列记录" in verdict.reason
    assert verdict.target_key == "能耗"
    assert verdict.feature_keys == ("温度", "负荷")
    assert verdict.algo == "linear_regression"
    assert verdict.task == "regression"
