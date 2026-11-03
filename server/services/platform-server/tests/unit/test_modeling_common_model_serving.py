"""常用监督模型经真实流水线、封存与发布后保持单行和批量预测一致。"""

from dataclasses import replace

import pytest

from platform_server.apps.modeling.operators import Frame
from platform_server.apps.modeling.operators.supervised_config import (
    CLASSIFICATION_LABELS,
    REGRESSION_LABELS,
)
from platform_server.apps.modeling.schemas.graph import PipelineGraph
from platform_server.apps.modeling.services.artifact_store import load, meta_of
from platform_server.apps.modeling.services.entry_contract import NodeRecord
from platform_server.apps.modeling.services.publish_service import inspect_run
from platform_server.apps.modeling.services.run_executor import (
    RunOutcome,
    execute_graph,
)
from platform_server.apps.modeling.services.serving import compile_model
from unit.modeling_fakes import (
    DirectRunner,
    edge,
    execution_of,
    linear_frame,
    node,
)

MODEL_CASES = [
    *(("regression_model", key) for key in REGRESSION_LABELS),
    *(("classification_model", key) for key in CLASSIFICATION_LABELS),
]


def model_graph(code: str, algorithm: str) -> PipelineGraph:
    return PipelineGraph(
        nodes=[
            node(
                "s",
                "ledger_source",
                table_code="energy_h",
                columns=["温度", "负荷", "能耗"],
            ),
            node("p", "split_dataset", target_column="能耗"),
            node(
                "m",
                code,
                algorithm=algorithm,
                n_estimators=8,
                boosting_iterations=8,
                max_iter=80,
                hidden_layers=[8],
            ),
            node("i", "feature_importance", repeats=1),
        ],
        edges=[
            edge("e1", "s", "frame", "p", "frame"),
            edge("e2", "p", "train", "m", "train"),
            edge("e3", "p", "test", "m", "test"),
            edge("e4", "m", "model", "i", "model"),
            edge("e5", "p", "test", "i", "test"),
        ],
    )


def source_frame(code: str) -> Frame:
    frame = linear_frame(120)
    if code == "regression_model":
        return frame
    labels = (-2.5, 1.5, 4.5)
    return replace(
        frame,
        rows=tuple(
            (
                float(seat % 7 + (seat % 3) * 4),
                float(seat % 11 + (seat % 3) * 3),
                labels[seat % 3],
            )
            for seat in range(frame.row_count)
        ),
    )


def records_of(outcome: RunOutcome) -> dict[str, NodeRecord]:
    return {
        item.node_id: NodeRecord(
            preview=item.preview,
            fitted=item.fitted,
            io=item.io,
            artifact=(
                None
                if item.artifact is None
                else meta_of(
                    item.artifact, f"modeling/runs/synthetic/{item.node_id}.pkl"
                )
            ),
        )
        for item in outcome.nodes
    }


@pytest.mark.parametrize(("code", "algorithm"), MODEL_CASES)
async def test_model_publish_restores_estimator_and_original_class_mapping(
    code: str, algorithm: str
) -> None:
    graph = model_graph(code, algorithm)
    outcome = await execute_graph(
        graph,
        execution=execution_of(
            DirectRunner(), frames={"s": source_frame(code)}
        ),
    )
    assert outcome.status == "succeeded", outcome.error_text
    models = {item.node_id: item for item in outcome.nodes}
    sealed = models["m"].artifact
    assert sealed is not None
    estimator = load(
        sealed.payload,
        digest=sealed.digest,
        format_version=sealed.format_version,
        runtime=sealed.runtime,
    )
    verdict = inspect_run(graph, records_of(outcome), estimator)
    assert verdict.is_servable, verdict.reason
    compiled = compile_model(verdict.serving, estimator=estimator)
    sample = models["p"].frames["test"].rows[0]
    first, second = sample[:2]
    assert isinstance(first, float)
    assert isinstance(second, float)
    inputs: list[float | None] = [first, second]
    expected = models["m"].frames["scored"].rows[0][1]
    assert isinstance(expected, float)
    assert compiled.predict(inputs) == pytest.approx(expected)
    assert compiled.predict_many([(inputs, None)]) == pytest.approx([expected])
    assert models["i"].status == "succeeded"
