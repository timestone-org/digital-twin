"""全目录算子与算法经真实 spawn 计算子进程后保留结果、报告及模型发布能力。"""

import json
import math
import multiprocessing
import os
from collections.abc import Iterator
from concurrent.futures import ProcessPoolExecutor

import pytest
from unit.anomaly_fakes import normal_frame, training_pair
from unit.modeling_fakes import execution_of
from unit.supervised_fakes import samples
from unit.test_modeling_anomaly_models import ALGORITHMS as ANOMALY_ALGORITHMS
from unit.test_modeling_anomaly_models import anomaly_graph
from unit.test_modeling_clustering_analysis import (
    ALGORITHMS as CLUSTER_ALGORITHMS,
)
from unit.test_modeling_clustering_analysis import source as cluster_source
from unit.test_modeling_common_model_serving import (
    MODEL_CASES,
    model_graph,
    records_of,
    source_frame,
)

from contract.modeling_algorithm_configs import algorithm_configs
from contract.test_modeling_report_coverage import cases
from platform_server.apps.modeling.operators import (
    Frame,
    MetricsPayload,
    ModelPayload,
    OperatorError,
    registry,
)
from platform_server.apps.modeling.services import preview, report_budget
from platform_server.apps.modeling.services.artifact_store import load
from platform_server.apps.modeling.services.node_task import (
    NodePayload,
    NodeResult,
)
from platform_server.apps.modeling.services.publish_service import inspect_run
from platform_server.apps.modeling.services.run_executor import execute_graph
from platform_server.apps.modeling.services.run_pool import (
    NodePool,
    PooledRunner,
)
from platform_server.apps.modeling.services.serving import compile_model

MODEL_ALGORITHMS = [
    *MODEL_CASES,
    *(("anomaly_model", key) for key in ANOMALY_ALGORITHMS),
]


@pytest.fixture(scope="module")
def calculation_pool() -> Iterator[NodePool]:
    """与 worker 一致的独占进程池，显式用全新解释器启动。"""
    pool = NodePool(
        factory=lambda: ProcessPoolExecutor(
            max_workers=1, mp_context=multiprocessing.get_context("spawn")
        )
    )
    try:
        yield pool
    finally:
        pool.shutdown()


def payload_of(code: str) -> NodePayload:
    """沿用报告契约的真实输入，不绕过配置验证。Args: code。"""
    inputs, config = cases()[code]
    return NodePayload(
        operator=code,
        config=config,
        inputs=inputs,
        tz_offset_minutes=480,
        split_plan=None,
    )


def assert_result_contract(code: str, result: NodeResult) -> None:
    """核对端口、全量帧、结果摘要与报告的跨进程契约。Args: code, result。"""
    spec = registry.get(code)
    assert set(result.outputs) == {port.name for port in spec.OUTPUTS}
    for port, value in result.outputs.items():
        if isinstance(value, Frame):
            assert value.row_count > 0, (code, port)
            assert all(len(row) == len(value.columns) for row in value.rows)
            assert result.io["outputs"][port] == list(value.keys)
        summary, _ = preview.fit_budget(preview.summarize(value))
        assert (
            json.loads(json.dumps(summary, allow_nan=False))["kind"]
            != "unknown"
        )
    report = report_budget.fit_report(result.report)
    assert report is not None
    assert report["blocks"]
    assert report["dropped"] == []
    assert (
        json.loads(json.dumps(result.fitted, allow_nan=False)) == result.fitted
    )
    if spec.SERVING_CHANNEL == "binary":
        assert result.artifact is not None


async def test_calculation_pool_runs_outside_request_process(
    calculation_pool: NodePool,
) -> None:
    assert await calculation_pool.run(os.getpid) != os.getpid()


@pytest.mark.parametrize("code", registry.codes())
async def test_every_operator_crosses_real_worker_process_boundary(
    code: str, calculation_pool: NodePool
) -> None:
    runner = PooledRunner(calculation_pool, timeout_s=60)
    result = await runner.run(payload_of(code))
    assert_result_contract(code, result)


@pytest.mark.parametrize("algorithm", CLUSTER_ALGORITHMS)
async def test_clustering_algorithms_compute_real_groups_in_worker(
    algorithm: str, calculation_pool: NodePool
) -> None:
    frame = cluster_source()
    result = await PooledRunner(calculation_pool, timeout_s=60).run(
        NodePayload(
            operator="clustering_analysis",
            config={"algorithm": algorithm},
            inputs={"frame": frame},
            tz_offset_minutes=480,
            split_plan=None,
        )
    )
    output = result.outputs["frame"]
    metrics = result.outputs["metrics"]
    assert isinstance(output, Frame)
    assert isinstance(metrics, MetricsPayload)
    assert tuple(row[:2] for row in output.rows) == frame.rows
    assert output.index == frame.index
    assert metrics.metrics["cluster_count"] == 3
    assert metrics.metrics["silhouette"] > 0.9
    assert result.artifact is None


@pytest.mark.parametrize(("code", "algorithm"), MODEL_ALGORITHMS)
async def test_worker_model_graph_publishes_and_replays_single_and_batch(
    code: str, algorithm: str, calculation_pool: NodePool
) -> None:
    is_anomaly = code == "anomaly_model"
    graph = (
        anomaly_graph(algorithm) if is_anomaly else model_graph(code, algorithm)
    )
    frame = normal_frame() if is_anomaly else source_frame(code)
    outcome = await execute_graph(
        graph,
        execution=execution_of(
            PooledRunner(calculation_pool, timeout_s=60), frames={"s": frame}
        ),
    )
    assert outcome.status == "succeeded", outcome.error_text
    assert all(item.status == "succeeded" for item in outcome.nodes)
    nodes = {item.node_id: item for item in outcome.nodes}
    sealed = nodes["m"].artifact
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
    if is_anomaly:
        rows = [[33.65, 40.0, 71.0], [100.0, 100.0, 150.0]]
        expected = [compiled.predict(row) for row in rows]
        assert all(
            value is not None and math.isfinite(value) for value in expected
        )
        assert expected[1] > 1
    else:
        rows = [list(row[:2]) for row in nodes["p"].frames["test"].rows[:3]]
        expected = [row[1] for row in nodes["m"].frames["scored"].rows[:3]]
        assert [compiled.predict(row) for row in rows] == pytest.approx(
            expected
        )
        assert nodes["i"].status == "succeeded"
        assert isinstance(nodes["m"].preview["model"]["task"], str)
    assert compiled.predict_many(
        [(row, None) for row in rows]
    ) == pytest.approx(expected)


@pytest.mark.parametrize(("code", "algorithm"), MODEL_ALGORITHMS)
async def test_learning_algorithms_run_with_unmodified_default_parameters(
    code: str, algorithm: str, calculation_pool: NodePool
) -> None:
    if code == "anomaly_model":
        inputs = training_pair()
    else:
        train, test = samples(
            is_classification=code == "classification_model", classes=2
        )
        inputs = {"train": train, "test": test}
    result = await PooledRunner(calculation_pool, timeout_s=60).run(
        NodePayload(
            operator=code,
            config={"algorithm": algorithm},
            inputs=inputs,
            tz_offset_minutes=480,
            split_plan=None,
        )
    )
    assert_result_contract(code, result)
    scored = result.outputs["scored"]
    assert isinstance(scored, Frame)
    assert scored.row_count == inputs["test"].row_count
    if code == "classification_model":
        assert set(scored.values_of("y_pred")) <= {-2.5, 1.5}
    key = "anomaly_score" if code == "anomaly_model" else "y_pred"
    assert all(math.isfinite(value) for value in scored.values_of(key))


@pytest.mark.parametrize(
    ("code", "config"),
    algorithm_configs(),
    ids=[f"{code}:{config}" for code, config in algorithm_configs()],
)
async def test_configured_algorithm_branches_execute_without_losing_parameters(
    code: str, config: dict[str, object], calculation_pool: NodePool
) -> None:
    if code == "clustering_analysis":
        inputs = {"frame": cluster_source()}
    elif code == "anomaly_model":
        inputs = training_pair()
    else:
        train, test = samples(
            is_classification=code == "classification_model", classes=2
        )
        inputs = {"train": train, "test": test}
    result = await PooledRunner(calculation_pool, timeout_s=60).run(
        NodePayload(
            operator=code,
            config=config,
            inputs=inputs,
            tz_offset_minutes=480,
            split_plan=None,
        )
    )
    assert_result_contract(code, result)
    if code == "clustering_analysis":
        assert result.outputs["metrics"].metrics["cluster_count"] >= 2
    else:
        model = result.outputs["model"]
        assert isinstance(model, ModelPayload)
        assert all(
            model.hyper_params[key] == value for key, value in config.items()
        )
        if code == "classification_model" and config.get("sgd_loss") == "hinge":
            assert result.outputs["scored"].values_of("y_proba") == [None] * 30


async def test_invalid_operator_input_fails_then_next_worker_task_succeeds(
    calculation_pool: NodePool,
) -> None:
    runner = PooledRunner(calculation_pool, timeout_s=60)
    with pytest.raises(OperatorError):
        await runner.run(
            NodePayload(
                operator="column_math",
                config={"left_column": "不存在", "output_column": "结果"},
                inputs={"frame": cluster_source()},
                tz_offset_minutes=480,
                split_plan=None,
            )
        )
    result = await runner.run(payload_of("linear_regression"))
    model = result.outputs["model"]
    assert isinstance(model, ModelPayload)
    assert model.task == "regression"
