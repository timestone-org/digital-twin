"""监督模型的交叉验证、契约拒绝和无效预测边界。"""

import math
from dataclasses import replace

import pytest

import platform_server.apps.modeling.operators.supervised as supervised_module
from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    MetricsPayload,
    OperatorError,
    registry,
)
from platform_server.apps.modeling.operators.supervised_boundary import (
    FittedEstimator,
)
from unit.supervised_fakes import samples


@pytest.mark.parametrize(
    ("code", "algorithm"),
    [
        ("regression_model", "ridge"),
        ("regression_model", "random_forest"),
        ("classification_model", "logistic"),
        ("classification_model", "random_forest"),
        ("regression_model", "xgboost"),
        ("regression_model", "lightgbm"),
        ("regression_model", "catboost"),
        ("classification_model", "xgboost"),
        ("classification_model", "lightgbm"),
        ("classification_model", "catboost"),
    ],
)
def test_family_models_support_fresh_training_in_each_validation_fold(
    code: str, algorithm: str
) -> None:
    train, test = samples(is_classification=code == "classification_model")
    model, _ = registry.build(code, {"algorithm": algorithm, "n_estimators": 8})
    payload = model.run({"train": train, "test": test})["model"]
    validator, _ = registry.build("cross_validate", {"folds": 3})
    output = validator.run({"model": payload, "frame": train})["metrics"]
    assert isinstance(output, MetricsPayload)
    assert all(
        value is None or math.isfinite(value)
        for value in output.metrics.values()
    )
    assert validator.report()[0].zone == "step"


@pytest.mark.parametrize(
    ("algorithm", "count"), [("ridge", 100_001), ("svr", 5001), ("mlp", 50_001)]
)
def test_model_training_row_budgets_are_checked_before_fitting(
    algorithm: str, count: int
) -> None:
    train, test = samples(is_classification=False)
    too_large = replace(train, rows=(train.rows[0],) * count, index=None)
    model, _ = registry.build("regression_model", {"algorithm": algorithm})
    with pytest.raises(OperatorError, match="最多训练"):
        model.run({"train": too_large, "test": test})


def test_training_rejects_empty_rows_no_features_and_excessive_width() -> None:
    train, test = samples(is_classification=False)
    model, _ = registry.build("regression_model", {})
    with pytest.raises(OperatorError, match="至少一行"):
        model.run({"train": replace(train, rows=(), index=()), "test": test})
    no_features = replace(
        train,
        columns=tuple(
            (
                replace(column, role="ignored")
                if column.role == "feature"
                else column
            )
            for column in train.columns
        ),
    )
    with pytest.raises(OperatorError, match="一个特征"):
        model.run({"train": no_features, "test": test})
    columns = (
        *(
            FrameColumn(key=f"x{seat}", name=f"x{seat}", dtype="number")
            for seat in range(129)
        ),
        train.columns[-1],
    )
    with pytest.raises(OperatorError, match="128"):
        model.run(
            {
                "train": Frame(columns=columns, rows=((1.0,) * 130,)),
                "test": test,
            }
        )


@pytest.mark.parametrize(
    "metadata",
    [
        {},
        {"feature_keys": ["x", "x"], "classes": [], "algorithm": "ridge"},
        {"feature_keys": [1], "classes": [], "algorithm": "ridge"},
        {"feature_keys": ["x"], "classes": [math.inf], "algorithm": "ridge"},
        {"feature_keys": ["x"], "classes": [2.0, 1.0], "algorithm": "ridge"},
        {"feature_keys": ["x"], "classes": [True], "algorithm": "ridge"},
        {"feature_keys": ["x"], "classes": []},
    ],
)
def test_corrupt_fitted_metadata_is_rejected(
    metadata: dict[str, object],
) -> None:
    model, _ = registry.build("regression_model", {})
    with pytest.raises(OperatorError):
        model.load_fitted(metadata)


def test_fitted_metadata_requires_task_appropriate_classes() -> None:
    classifier, _ = registry.build("classification_model", {})
    with pytest.raises(OperatorError, match="类别映射"):
        classifier.load_fitted(
            {"feature_keys": ["first"], "classes": [], "algorithm": "logistic"}
        )
    regressor, _ = registry.build("regression_model", {})
    with pytest.raises(OperatorError, match="回归模型"):
        regressor.load_fitted(
            {
                "feature_keys": ["first"],
                "classes": [0.0, 1.0],
                "algorithm": "ridge",
            }
        )
    with pytest.raises(OperatorError, match="还没有拟合"):
        regressor.predict_rows(samples(is_classification=False)[1])


@pytest.mark.parametrize("algorithm", ["ridge", "knn", "svr", "mlp"])
def test_models_allow_explicitly_disabling_internal_scaling(
    algorithm: str,
) -> None:
    train, test = samples(is_classification=False)
    model, _ = registry.build(
        "regression_model",
        {
            "algorithm": algorithm,
            "should_standardize": False,
            "max_iter": 20,
            "hidden_layers": [4],
        },
    )
    model.run({"train": train, "test": test})
    assert model.trained_estimator() is not None
    assert all(math.isfinite(value) for value in model.predict_rows(test))


def test_adoption_rejects_feature_count_and_category_mapping_drift() -> None:
    train, test = samples(is_classification=True)
    fitted, _ = registry.build(
        "classification_model", {"algorithm": "decision_tree"}
    )
    fitted.run({"train": train, "test": test})
    restored, _ = registry.build(
        "classification_model", {"algorithm": "decision_tree"}
    )
    restored.load_fitted(
        {
            "feature_keys": ["first"],
            "classes": [-2.5, 1.5, 4.5],
            "algorithm": "decision_tree",
        }
    )
    with pytest.raises(OperatorError, match="特征数量"):
        restored.attach_estimator(fitted.trained_estimator())
    restored.load_fitted(
        {
            "feature_keys": ["first", "second"],
            "classes": [-2.5, 1.5],
            "algorithm": "decision_tree",
        }
    )
    with pytest.raises(OperatorError, match="类别编码"):
        restored.attach_estimator(fitted.trained_estimator())


class WrongPredictor:
    def __init__(self, result: object) -> None:
        self.result = result

    def predict(self, _rows: object) -> object:
        return self.result

    def predict_proba(self, _rows: object) -> object:
        return self.result


@pytest.mark.parametrize("result", [[], [[1.0, 2.0]], [math.nan], [math.inf]])
def test_prediction_boundary_refuses_wrong_shapes_and_nonfinite_values(
    result: object,
) -> None:
    model = FittedEstimator(WrongPredictor(result))
    with pytest.raises(OperatorError):
        model.predict([[1.0]])


@pytest.mark.parametrize(
    "result", [[[1.0]], [[-0.1, 1.1]], [[math.nan, math.nan]]]
)
def test_probability_boundary_refuses_invalid_probability_values(
    result: object,
) -> None:
    model = FittedEstimator(WrongPredictor(result))
    with pytest.raises(OperatorError):
        model.positive_probabilities([[1.0]])


def test_boundary_requires_predict_and_keeps_empty_probability_output() -> None:
    with pytest.raises(OperatorError, match="可预测"):
        FittedEstimator(object())
    assert FittedEstimator(WrongPredictor([])).positive_probabilities([]) == []


def test_extreme_finite_training_values_fail_explicitly() -> None:
    train, test = samples(is_classification=False)
    extreme = replace(
        train, rows=tuple((1e308, -1e308, 1e308) for _row in train.rows)
    )
    model, _ = registry.build(
        "regression_model",
        {"algorithm": "sgd", "should_standardize": False, "max_iter": 3},
    )
    with pytest.raises(OperatorError, match="拟合失败"):
        model.run({"train": extreme, "test": test})


def test_native_conversion_failures_are_translated_to_domain_errors() -> None:
    model = FittedEstimator(WrongPredictor(["not a number"]))
    with pytest.raises(OperatorError, match="无法计算"):
        model.predict([[1.0]])
    with pytest.raises(OperatorError, match="无法产生"):
        model.positive_probabilities([[1.0]])


def test_model_can_report_an_explicitly_empty_test_frame() -> None:
    train, test = samples(is_classification=False)
    model, _ = registry.build("regression_model", {})
    result = model.run(
        {"train": train, "test": replace(test, rows=(), index=())}
    )["scored"]
    assert isinstance(result, Frame)
    assert result.row_count == 0
    assert model.report()[1].payload["items"][0]["value"] is None


@pytest.mark.parametrize(
    "algorithm", ["random_forest", "hist_gradient_boosting", "catboost"]
)
def test_multiclass_tree_combinations_fail_before_native_creation(
    algorithm: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    template, test = samples(is_classification=True)
    train = Frame(
        columns=template.columns,
        rows=tuple(
            (float(seat), float(seat % 7), float(seat % 100))
            for seat in range(300)
        ),
    )
    model, _ = registry.build(
        "classification_model",
        {
            "algorithm": algorithm,
            "n_estimators": 300,
            "boosting_iterations": 1000,
            "max_leaf_nodes": 1024,
            "max_depth": 30,
            "catboost_depth": 10,
        },
    )
    monkeypatch.setattr(
        supervised_module,
        "classification_estimator",
        lambda _config: pytest.fail("超过预算时不得创建或拟合模型"),
    )
    with pytest.raises(OperatorError, match="降低树数量"):
        model.run({"train": train, "test": test})


@pytest.mark.parametrize(
    "algorithm",
    [
        "decision_tree",
        "random_forest",
        "extra_trees",
        "gradient_boosting",
        "hist_gradient_boosting",
        "adaboost",
        "xgboost",
        "lightgbm",
        "catboost",
    ],
)
def test_tree_default_parameters_fit_normal_multiclass_data(
    algorithm: str,
) -> None:
    train, test = samples(is_classification=True)
    model, _ = registry.build("classification_model", {"algorithm": algorithm})
    result = model.run({"train": train, "test": test})["scored"]
    assert isinstance(result, Frame)
    assert result.row_count == test.row_count
