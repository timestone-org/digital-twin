"""四类异常模型的校准隔离、真实二进制往返与严格输入。"""

import json
import math
from dataclasses import replace

import pytest
from pydantic import ValidationError
from sklearn.ensemble import IsolationForest
from sklearn.neighbors import LocalOutlierFactor

from platform_server.apps.modeling.operators import (
    Frame,
    ModelPayload,
    OperatorError,
    registry,
)
from platform_server.apps.modeling.schemas.graph import PipelineGraph
from platform_server.apps.modeling.services.artifact_store import load, seal
from platform_server.apps.modeling.services.publish_service import inspect_run
from platform_server.apps.modeling.services.run_executor import execute_graph
from platform_server.apps.modeling.services.serving import compile_model
from unit.anomaly_fakes import normal_frame, training_pair
from unit.modeling_fakes import DirectRunner, edge, execution_of, node
from unit.test_modeling_channel_b import _estimator_of, _records_of

ALGORITHMS = (
    "isolation_forest",
    "local_outlier_factor",
    "one_class_svm",
    "elliptic_envelope",
)


def anomaly_graph(algorithm: str) -> PipelineGraph:
    return PipelineGraph(
        nodes=[
            node(
                "s",
                "ledger_source",
                table_code="normal",
                columns=["电流", "频率", "温度"],
            ),
            node("p", "split_samples", test_ratio=0.2, min_test_rows=20),
            node("m", "anomaly_model", algorithm=algorithm, n_estimators=20),
        ],
        edges=[
            edge("sp", "s", "frame", "p", "frame"),
            edge("pm_train", "p", "train", "m", "train"),
            edge("pm_test", "p", "test", "m", "test"),
        ],
    )


@pytest.mark.parametrize("algorithm", ALGORITHMS)
async def test_pipeline_artifact_publish_and_compiled_single_batch_agree(
    algorithm: str,
) -> None:
    graph = anomaly_graph(algorithm)
    outcome = await execute_graph(
        graph,
        execution=execution_of(DirectRunner(), frames={"s": normal_frame()}),
    )
    assert outcome.status == "succeeded", outcome.error_text
    estimator = _estimator_of(outcome)
    verdict = inspect_run(graph, _records_of(outcome), estimator)
    assert verdict.is_servable is True, verdict.reason
    assert verdict.task == "anomaly_detection"
    assert verdict.target_key is None
    assert verdict.channel == "binary"
    assert verdict.signature["output"]["key"] == "anomaly_score"
    assert verdict.signature["output"]["task"] == "anomaly_detection"
    assert all(column["is_required"] for column in verdict.signature["inputs"])
    compiled = compile_model(verdict.serving, estimator=estimator)
    rows = [[33.65, 40.0, 71.0], [100.0, 100.0, 150.0]]
    single = [compiled.predict(row) for row in rows]
    batch = compiled.predict_many([(row, None) for row in rows])
    assert single == pytest.approx(batch)
    assert batch[1] > 1
    assert compiled.predict_many(
        [(rows[0], None), (rows[0], None)]
    ) == pytest.approx([batch[0], batch[0]])


def trained(algorithm: str = "isolation_forest"):
    operator, _ = registry.build(
        "anomaly_model", {"algorithm": algorithm, "n_estimators": 20}
    )
    result = operator.run(training_pair())
    return operator, result


def probe() -> Frame:
    return replace(
        normal_frame(),
        rows=((33.65, 40.0, 71.0), (100.0, 100.0, 150.0)),
        index=None,
    )


@pytest.mark.parametrize("algorithm", ALGORITHMS)
def test_all_anomaly_algorithms_train_and_flag_new_extreme_samples(
    algorithm: str,
) -> None:
    operator, result = trained(algorithm)
    scores = operator.predict_rows(probe())
    assert len(scores) == 2
    assert all(math.isfinite(score) and score >= 0 for score in scores)
    assert scores[1] > 1
    payload = result["model"]
    assert isinstance(payload, ModelPayload)
    assert payload.task == "anomaly_detection"
    assert payload.target_key is None
    assert payload.serving_channel == "binary"
    assert result["scored"].keys == ("anomaly_score", "is_anomaly")
    assert result["metrics"].metrics["test_rows"] == 100
    assert {block.zone for block in operator.report()} >= {"step", "charts"}


@pytest.mark.parametrize("algorithm", ALGORITHMS)
def test_native_artifact_and_json_profile_roundtrip(
    algorithm: str,
) -> None:
    operator, _ = trained(algorithm)
    profile = operator.dump_fitted()
    json.dumps(profile, allow_nan=False)
    estimator = operator.trained_estimator()
    assert estimator is not None
    sealed = seal(estimator)
    restored = load(
        sealed.payload,
        digest=sealed.digest,
        format_version=sealed.format_version,
        runtime=sealed.runtime,
    )
    replay, _ = registry.build("anomaly_model", {"algorithm": algorithm})
    replay.load_fitted(profile)
    replay.attach_estimator(restored)
    assert replay.predict_rows(probe()) == pytest.approx(
        operator.predict_rows(probe())
    )
    assert profile["fit_rows"] == 300
    assert profile["calibration_rows"] == 100
    if algorithm == "local_outlier_factor":
        assert isinstance(estimator, LocalOutlierFactor)
        assert estimator.novelty is True


@pytest.mark.parametrize("algorithm", ALGORITHMS)
def test_independent_test_data_never_changes_fitting_or_calibration(
    algorithm: str,
) -> None:
    first, _ = trained(algorithm)
    pair = training_pair()
    pair["test"] = replace(
        pair["test"],
        rows=tuple((100.0, 100.0, 150.0) for _ in pair["test"].rows),
    )
    second, _ = registry.build(
        "anomaly_model", {"algorithm": algorithm, "n_estimators": 20}
    )
    second.run(pair)
    assert first.dump_fitted() == second.dump_fitted()


@pytest.mark.parametrize(
    "value", [None, True, float("nan"), float("inf"), 1e101]
)
def test_invalid_online_inputs_are_never_encoded_as_normal(
    value: object,
) -> None:
    operator, _ = trained()
    frame = replace(probe(), rows=((value, 40.0, 71.0),))
    with pytest.raises(OperatorError):
        operator.predict_rows(frame)


@pytest.mark.parametrize(
    "kind",
    ["short", "overlap", "time", "order", "role", "columns", "missing", "text"],
)
def test_invalid_training_layout_and_values_fail_explicitly(kind: str) -> None:
    pair = training_pair()
    train = pair["train"]
    if kind == "short":
        train = replace(train, rows=train.rows[:79], index=train.index[:79])
    if kind == "overlap":
        pair["test"] = train
    if kind == "time":
        train = replace(train, index=None)
    if kind == "order":
        train = replace(train, index=tuple(reversed(train.index)))
    if kind == "role":
        train = replace(
            train,
            columns=tuple(
                replace(column, role="target") for column in train.columns
            ),
        )
    if kind == "columns":
        pair["test"] = replace(
            pair["test"], columns=tuple(reversed(train.columns))
        )
    if kind == "missing":
        train = replace(train, rows=((None, 40.0, 71.0), *train.rows[1:]))
    if kind == "text":
        train = replace(
            train,
            columns=tuple(
                replace(column, dtype="string") for column in train.columns
            ),
        )
    pair["train"] = train
    operator, _ = registry.build("anomaly_model", {})
    with pytest.raises(OperatorError):
        operator.run(pair)


def test_untrained_or_mismatched_artifact_cannot_predict() -> None:
    operator, _ = registry.build("anomaly_model", {})
    assert operator.report() == ()
    assert operator.dump_fitted() == {}
    assert operator.trained_estimator() is None
    with pytest.raises(OperatorError):
        operator.predict_rows(probe())
    with pytest.raises(OperatorError):
        operator.attach_estimator(IsolationForest())
    ready, _ = trained()
    with pytest.raises(OperatorError):
        ready.attach_estimator(LocalOutlierFactor(novelty=True))
    with pytest.raises(OperatorError):
        ready.attach_estimator(IsolationForest())


@pytest.mark.parametrize(
    "patch",
    [
        {"score_scale": 0},
        {"threshold_raw": float("inf")},
        {"feature_keys": ["x", "x"]},
        {"center": {}},
        {"extra": "no"},
    ],
)
def test_corrupt_frozen_profiles_are_rejected(patch: dict[str, object]) -> None:
    operator, _ = trained()
    with pytest.raises(OperatorError):
        type(operator).validate_fitted({**operator.dump_fitted(), **patch})


def test_wrong_algorithm_profile_and_wrong_column_order_are_rejected() -> None:
    operator, _ = trained()
    wrong, _ = registry.build("anomaly_model", {"algorithm": "one_class_svm"})
    with pytest.raises(OperatorError):
        wrong.load_fitted(operator.dump_fitted())
    with pytest.raises(OperatorError):
        operator.predict_rows(
            replace(probe(), columns=tuple(reversed(probe().columns)))
        )
    assert operator.predict_rows(replace(probe(), rows=(), index=())) == []


@pytest.mark.parametrize(
    "config",
    [
        {"quantile": 1.0},
        {"calibration_ratio": 0},
        {"gamma": 0},
        {"max_iter": -1},
        {"algorithm": "unknown"},
    ],
)
def test_invalid_or_unbounded_hyperparameters_are_rejected(
    config: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        registry.build("anomaly_model", config)


@pytest.mark.parametrize("algorithm", ALGORITHMS)
@pytest.mark.parametrize("kind", ["all", "fit_only"])
def test_all_constant_learning_features_cannot_claim_a_usable_model(
    algorithm: str,
    kind: str,
) -> None:
    pair = training_pair()
    if kind == "all":
        for port, frame in pair.items():
            pair[port] = replace(
                frame, rows=tuple((1.0, 2.0, 3.0) for _ in frame.rows)
            )
    if kind == "fit_only":
        frame = pair["train"]
        pair["train"] = replace(
            frame,
            rows=(*((1.0, 2.0, 3.0) for _ in range(300)), *frame.rows[300:]),
        )
    operator, _ = registry.build(
        "anomaly_model", {"algorithm": algorithm, "n_estimators": 20}
    )
    with pytest.raises(
        OperatorError, match="正常样本没有变化，无法建立可用异常模型"
    ):
        operator.run(pair)


@pytest.mark.parametrize("algorithm", ALGORITHMS)
def test_partial_constant_warning_survives_profile_and_artifact_roundtrip(
    algorithm: str,
) -> None:
    pair = training_pair()
    for port, frame in pair.items():
        pair[port] = replace(
            frame, rows=tuple((row[0], 40.0, row[2]) for row in frame.rows)
        )
    operator, _ = registry.build(
        "anomaly_model", {"algorithm": algorithm, "n_estimators": 20}
    )
    operator.run(pair)
    profile = operator.dump_fitted()
    assert profile["constant_columns"] == ["频率"]
    sealed = seal(operator.trained_estimator())
    restored, _ = registry.build("anomaly_model", {"algorithm": algorithm})
    restored.load_fitted(profile)
    restored.attach_estimator(
        load(
            sealed.payload,
            digest=sealed.digest,
            format_version=sealed.format_version,
            runtime=sealed.runtime,
        )
    )
    for model in (operator, restored):
        notes = [
            note["text"]
            for block in model.report()
            for note in block.payload.get("notes", [])
        ]
        assert any("频率" in text and "不参与" in text for text in notes)
        assert any("偏离" in text for text in notes)
    assert restored.predict_rows(probe()) == pytest.approx(
        operator.predict_rows(probe())
    )
