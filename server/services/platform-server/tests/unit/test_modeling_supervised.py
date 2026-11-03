"""三十一种监督模型真实拟合、受限封存回放与配置边界。"""

import math
from dataclasses import replace

import pytest
from pydantic import ValidationError

from platform_server.apps.modeling.operators import (
    Frame,
    ModelPayload,
    OperatorError,
    registry,
)
from platform_server.apps.modeling.operators.supervised_config import (
    CLASSIFICATION_LABELS,
    REGRESSION_LABELS,
)
from platform_server.apps.modeling.services.artifact_store import load, seal
from unit.supervised_fakes import samples


@pytest.mark.parametrize(
    ("code", "algorithm"),
    [("regression_model", name) for name in REGRESSION_LABELS]
    + [("classification_model", name) for name in CLASSIFICATION_LABELS],
)
def test_all_supervised_algorithms_fit_and_replay_the_same_predictions(
    code: str, algorithm: str
) -> None:
    is_classification = code == "classification_model"
    train, test = samples(is_classification=is_classification)
    config: dict[str, object] = {
        "algorithm": algorithm,
        "n_estimators": 5,
        "max_iter": 60,
        "boosting_iterations": 5,
        "hidden_layers": [8],
    }
    model, parsed = registry.build(code, config)
    assert model.report() == ()
    outputs = model.run({"train": train, "test": test})
    payload, scored = outputs["model"], outputs["scored"]
    assert isinstance(payload, ModelPayload)
    assert isinstance(scored, Frame)
    assert scored.row_count == test.row_count
    assert (
        model.describe_columns(
            parsed, {"train": train.keys, "test": test.keys}
        )["scored"]
        == scored.keys
    )
    predicted = model.predict_rows(test)
    assert all(math.isfinite(value) for value in predicted)
    assert scored.values_of("y_pred") == predicted
    assert model.report()[0].zone == "step"
    artifact = seal(model.trained_estimator())
    native = load(
        artifact.payload,
        digest=artifact.digest,
        format_version=artifact.format_version,
        runtime=artifact.runtime,
    )
    restored, _ = registry.build(code, config)
    restored.load_fitted(model.dump_fitted() or {})
    restored.attach_estimator(native)
    assert restored.predict_rows(test) == pytest.approx(predicted)
    assert restored.predict_rows(replace(test, rows=(), index=())) == []
    if is_classification:
        assert set(predicted) <= {-2.5, 1.5, 4.5}
        assert payload.fitted["classes"] == [-2.5, 1.5, 4.5]
        assert scored.values_of("y_proba") == [None] * test.row_count


@pytest.mark.parametrize("algorithm", list(CLASSIFICATION_LABELS))
def test_binary_models_only_emit_real_positive_class_probabilities(
    algorithm: str,
) -> None:
    train, test = samples(is_classification=True, classes=2)
    model, _ = registry.build(
        "classification_model",
        {
            "algorithm": algorithm,
            "n_estimators": 4,
            "boosting_iterations": 4,
            "max_iter": 30,
            "hidden_layers": [5],
        },
    )
    scored = model.run({"train": train, "test": test})["scored"]
    assert isinstance(scored, Frame)
    probabilities = scored.values_of("y_proba")
    assert scored.column_of("y_proba").probability_classes == (-2.5, 1.5)
    if algorithm in {"svc", "linear_svc"}:
        assert probabilities == [None] * test.row_count
    else:
        assert all(
            isinstance(value, float) and 0 <= value <= 1
            for value in probabilities
        )


def test_model_standardization_is_fitted_only_on_training_rows() -> None:
    train, test = samples(is_classification=False)
    model, _ = registry.build("regression_model", {"algorithm": "ridge"})
    model.run({"train": train, "test": test})
    original = model.predict_rows(test)
    shifted = replace(
        test, rows=tuple((row[0] + 1e6, row[1], row[2]) for row in test.rows)
    )
    model.run({"train": train, "test": shifted})
    assert model.predict_rows(test) == pytest.approx(original)


def test_mlp_iteration_limit_is_visible_in_report() -> None:
    train, test = samples(is_classification=False)
    model, _ = registry.build(
        "regression_model",
        {"algorithm": "mlp", "max_iter": 1, "hidden_layers": [4]},
    )
    model.run({"train": train, "test": test})
    notes = model.report()[0].payload["notes"]
    assert any(
        note["level"] == "alert" and "收敛" in note["text"] for note in notes
    )


@pytest.mark.parametrize(
    ("code", "field"),
    [("regression_model", "first"), ("classification_model", "target")],
)
@pytest.mark.parametrize("value", [None, math.nan, math.inf])
def test_missing_and_nonfinite_values_are_rejected(
    code: str, field: str, value: float | None
) -> None:
    train, test = samples(is_classification=code == "classification_model")
    position = train.position_of(field)
    rows = list(train.rows)
    row = list(rows[0])
    row[position] = value
    rows[0] = tuple(row)
    model, _ = registry.build(code, {})
    with pytest.raises(OperatorError):
        model.run({"train": replace(train, rows=tuple(rows)), "test": test})


def test_classification_checks_classes_and_neighbor_count() -> None:
    train, test = samples(is_classification=True)
    one_class = replace(
        train, rows=tuple((*row[:2], 1.5) for row in train.rows)
    )
    model, _ = registry.build("classification_model", {})
    with pytest.raises(OperatorError, match="2 至 100"):
        model.run({"train": one_class, "test": test})
    neighbor, _ = registry.build(
        "classification_model", {"algorithm": "knn", "n_neighbors": 100}
    )
    with pytest.raises(OperatorError, match="近邻数量"):
        neighbor.run({"train": train, "test": test})


@pytest.mark.parametrize("code", ["regression_model", "classification_model"])
@pytest.mark.parametrize(
    "config",
    [
        {"max_iter": 2001},
        {"n_estimators": 301},
        {"max_depth": 0},
        {"max_leaf_nodes": 1025},
        {"hidden_layers": [257]},
        {"hidden_layers": [2, 2, 2, 2]},
        {"alpha": 0},
        {"class_weight": "unknown"},
    ],
)
def test_supervised_schema_bounds_are_enforced(
    code: str, config: dict[str, object]
) -> None:
    with pytest.raises(ValidationError):
        registry.build(code, config)


def test_metadata_refuses_mismatched_algorithms_and_artifacts() -> None:
    train, test = samples(is_classification=True)
    model, _ = registry.build(
        "classification_model", {"algorithm": "decision_tree"}
    )
    model.run({"train": train, "test": test})
    other, _ = registry.build("classification_model", {"algorithm": "knn"})
    with pytest.raises(OperatorError, match="算法"):
        other.load_fitted(model.dump_fitted() or {})
    regressor, _ = registry.build(
        "regression_model", {"algorithm": "decision_tree"}
    )
    regressor.run({"train": train, "test": test})
    with pytest.raises(OperatorError, match="算法类型"):
        model.attach_estimator(regressor.trained_estimator())
