"""前端正常工况模板真实执行后能发布无监督模型并完成检测。"""

import json
from pathlib import Path

from unit.anomaly_fakes import normal_frame
from unit.modeling_fakes import DirectRunner, execution_of

from platform_server.apps.modeling.schemas.graph import PipelineGraph
from platform_server.apps.modeling.services.entry_contract import NodeRecord
from platform_server.apps.modeling.services.graph_check import check_graph
from platform_server.apps.modeling.services.publish_service import inspect_run
from platform_server.apps.modeling.services.run_executor import execute_graph
from platform_server.apps.modeling.services.serving import compile_model

FIXTURE = (
    Path(__file__).resolve().parents[5]
    / "web/app/tests/pages/Modeling/fixtures/deviceAnomalyGraph.json"
)


def template() -> PipelineGraph:
    graph = PipelineGraph.model_validate(json.loads(FIXTURE.read_text()))
    graph.node_by_id()["s"].config["table_code"] = "normal_device"
    return graph


async def test_normal_only_template_publishes_without_a_fake_target() -> None:
    graph = template()
    assert check_graph(graph) == []
    outcome = await execute_graph(
        graph,
        execution=execution_of(DirectRunner(), frames={"s": normal_frame()}),
    )
    assert outcome.status == "succeeded", outcome.error_text
    records = {
        item.node_id: NodeRecord(
            preview=item.preview, fitted=item.fitted, io=item.io
        )
        for item in outcome.nodes
    }
    verdict = inspect_run(graph, records)
    assert verdict.is_servable, verdict.reason
    assert verdict.target_key is None
    assert verdict.task == "anomaly_detection"
    assert tuple(column.key for column in verdict.entry_columns) == (
        "电流",
        "频率",
        "温度",
    )
    assert verdict.signature["output"]["key"] == "anomaly_score"
    model = compile_model(verdict.serving)
    normal = model.predict([33.65, 40, 71])
    abnormal = model.predict([37, 33, 68])
    assert normal is not None
    assert normal < 1
    assert abnormal is not None
    assert abnormal > 1


async def test_standardization_supports_unlabeled_split() -> None:
    graph = template()
    graph.node_by_id()["d"].operator = "standardize"
    graph.node_by_id()["d"].config = {}
    outcome = await execute_graph(
        graph,
        execution=execution_of(DirectRunner(), frames={"s": normal_frame()}),
    )
    assert outcome.status == "succeeded", outcome.error_text
