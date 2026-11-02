"""模型任务声明、运行产物与模板图的类型保持一致。"""

import pytest

from platform_server.apps.modeling.errors import GraphInvalid
from platform_server.apps.modeling.operators import (
    CONTRACT_MODEL,
    Frame,
    FrameColumn,
    ModelPayload,
    registry,
)
from platform_server.apps.modeling.schemas.graph import GraphNode, PipelineGraph
from platform_server.apps.modeling.services import configuration
from unit.anomaly_fakes import training_pair

MODEL_TASKS = {
    "linear_regression": "regression",
    "logistic_regression": "classification",
    "tree_regressor": "regression",
    "anomaly_distance": "anomaly_detection",
    "energy_rules": "rule_calculation",
}


def _supervised_frame() -> Frame:
    return Frame(
        columns=(
            FrameColumn(
                key="温度", name="温度", dtype="number", role="feature"
            ),
            FrameColumn(key="报警", name="报警", dtype="number", role="target"),
        ),
        rows=((1.0, 0.0), (2.0, 0.0), (3.0, 0.0), (8.0, 1.0), (9.0, 1.0)),
    )


def _inputs(code: str) -> dict[str, Frame]:
    if code == "anomaly_distance":
        return training_pair()
    if code == "energy_rules":
        return {
            "frame": Frame(
                columns=(
                    FrameColumn(key="温度", name="温度", dtype="number"),
                    FrameColumn(key="湿度", name="湿度", dtype="number"),
                ),
                rows=((25.0, 40.0),),
            )
        }
    frame = _supervised_frame()
    return {"train": frame, "test": frame}


def test_every_model_producer_has_a_declared_task() -> None:
    producers = {
        code
        for code in registry.codes()
        if any(
            port.contract == CONTRACT_MODEL
            for port in registry.get(code).OUTPUTS
        )
    }
    assert producers == set(MODEL_TASKS)
    assert {
        code: registry.get(code).MODEL_TASK for code in producers
    } == MODEL_TASKS


def test_non_model_operators_have_no_task() -> None:
    assert all(
        registry.get(code).MODEL_TASK is None
        for code in registry.codes()
        if not any(
            port.contract == CONTRACT_MODEL
            for port in registry.get(code).OUTPUTS
        )
    )


def test_model_without_a_task_declaration_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(registry.get("linear_regression"), "MODEL_TASK", None)
    graph = PipelineGraph(
        nodes=[GraphNode(id="model", operator="linear_regression")]
    )
    with pytest.raises(GraphInvalid, match="未声明任务类型"):
        configuration.model_task_of(graph)


@pytest.mark.parametrize(("code", "task"), list(MODEL_TASKS.items()))
def test_graph_task_matches_the_trained_payload(code: str, task: str) -> None:
    config = {"kind": "hvac_compliance"} if code == "energy_rules" else {}
    operator, _ = registry.build(code, config)
    payload = operator.run(_inputs(code))["model"]
    assert isinstance(payload, ModelPayload)
    graph = PipelineGraph(nodes=[GraphNode(id="model", operator=code)])
    assert configuration.model_task_of(graph) == payload.task == task


@pytest.mark.parametrize(
    "operators", [[], ["ledger_source"], ["linear_regression", "energy_rules"]]
)
def test_graph_without_exactly_one_model_cannot_claim_a_task(
    operators: list[str],
) -> None:
    graph = PipelineGraph(
        nodes=[
            GraphNode(id=f"node-{index}", operator=code)
            for index, code in enumerate(operators)
        ]
    )
    with pytest.raises(GraphInvalid):
        configuration.model_task_of(graph)
