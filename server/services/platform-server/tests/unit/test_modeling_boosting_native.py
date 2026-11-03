"""三品牌六种原生 CPU 模型的安装、封存、还原与无文件输出契约。"""

from pathlib import Path

import pytest
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from platform_server.apps.modeling.operators.external_boosting import (
    create_boosting,
)
from platform_server.apps.modeling.operators.frame import matrix_of, numbers_of
from platform_server.apps.modeling.operators.supervised_boundary import (
    FittedEstimator,
)
from platform_server.apps.modeling.operators.supervised_config import (
    ClassificationModelConfig,
    RegressionModelConfig,
)
from platform_server.apps.modeling.services.artifact_store import (
    ArtifactRejected,
    load,
    seal,
)
from unit.supervised_fakes import samples


@pytest.mark.parametrize("algorithm", ["xgboost", "lightgbm", "catboost"])
@pytest.mark.parametrize("is_classification", [False, True])
@pytest.mark.parametrize("should_wrap", [False, True])
def test_native_boosting_is_cpu_single_threaded_and_roundtrips(
    algorithm: str,
    is_classification: bool,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    should_wrap: bool,
) -> None:
    monkeypatch.chdir(tmp_path)
    model, bare, rows = _fit_native(algorithm, is_classification, should_wrap)
    predicted = model.predict(rows)
    artifact = seal(model.estimator)
    assert algorithm in artifact.runtime
    assert set(artifact.runtime) & {"xgboost", "lightgbm", "catboost"} == {
        algorithm
    }
    restored = load(
        artifact.payload,
        digest=artifact.digest,
        format_version=artifact.format_version,
        runtime=artifact.runtime,
    )
    assert FittedEstimator(restored).predict(rows) == pytest.approx(predicted)
    _assert_cpu_parameters(bare, algorithm)
    assert list(tmp_path.iterdir()) == []
    with pytest.raises(ArtifactRejected, match="版本"):
        load(
            artifact.payload,
            digest=artifact.digest,
            format_version=artifact.format_version,
            runtime=artifact.runtime
            | {algorithm: artifact.runtime[algorithm] + ".different"},
        )


def _fit_native(
    algorithm: str, is_classification: bool, should_wrap: bool
) -> tuple[FittedEstimator, object, list[list[float]]]:
    train, test = samples(is_classification=is_classification)
    model_type = (
        ClassificationModelConfig
        if is_classification
        else RegressionModelConfig
    )
    config = model_type.model_validate(
        {
            "n_estimators": 5,
            "max_depth": 4,
            "max_leaf_nodes": 16,
            "catboost_depth": 4,
        }
    )
    bare = create_boosting(
        algorithm, config, is_classification=is_classification
    )
    native = (
        Pipeline([("scale", StandardScaler()), ("model", bare)])
        if should_wrap
        else bare
    )
    model = FittedEstimator(native)
    target = [
        value for value in numbers_of(train, "target") if value is not None
    ]
    if is_classification:
        classes = {
            value: seat for seat, value in enumerate(sorted(set(target)))
        }
        target = [float(classes[value]) for value in target]
    model.fit(matrix_of(train, ("first", "second")), target)
    return model, bare, matrix_of(test, ("first", "second"))


def _assert_cpu_parameters(bare: object, algorithm: str) -> None:
    params = bare.get_params()
    if algorithm == "catboost":
        assert params["task_type"] == "CPU"
        assert params["thread_count"] == 1
        assert params["allow_writing_files"] is False
    else:
        assert params["n_jobs"] == 1
        assert (
            params["device" if algorithm == "xgboost" else "device_type"]
            == "cpu"
        )


@pytest.mark.parametrize("algorithm", ["xgboost", "lightgbm", "catboost"])
def test_brand_visible_parameters_reach_supported_native_options(
    algorithm: str,
) -> None:
    config = ClassificationModelConfig.model_validate(
        {
            "algorithm": algorithm,
            "n_estimators": 8,
            "max_depth": 5,
            "max_leaf_nodes": 24,
            "min_samples_leaf": 4,
            "min_child_weight": 2.0,
            "learning_rate": 0.2,
            "boost_l1": 0.3,
            "boost_l2": 2.0,
            "row_subsample": 0.75,
            "feature_subsample": 0.8,
            "catboost_depth": 4,
            "class_weight": "balanced",
        }
    )
    native = create_boosting(algorithm, config, is_classification=True)
    params = native.get_params()
    assert params["learning_rate"] == 0.2
    assert params["subsample"] == 0.75
    if algorithm == "catboost":
        assert params["iterations"] == 8
        assert params["depth"] == 4
        assert params["l2_leaf_reg"] == 2.0
        assert params["rsm"] == 0.8
        assert params["auto_class_weights"] == "Balanced"
    else:
        assert params["n_estimators"] == 8
        assert params["max_depth"] == 5
        assert (
            params["max_leaves" if algorithm == "xgboost" else "num_leaves"]
            == 24
        )
        assert params["reg_alpha"] == 0.3
        assert params["reg_lambda"] == 2.0
        assert params["colsample_bytree"] == 0.8
    if algorithm == "xgboost":
        assert params["min_child_weight"] == 2.0
        assert "min_samples_leaf" not in params
    if algorithm == "lightgbm":
        assert params["min_child_samples"] == 4
        assert params["class_weight"] == "balanced"
        assert params["subsample_freq"] == 1
