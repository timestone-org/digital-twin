"""品牌提升模型的 CPU 构造边界，禁用文件输出与额外计算线程。"""

from collections.abc import Mapping
from types import ModuleType
from typing import Protocol, cast

import catboost
import lightgbm
import xgboost

from platform_server.apps.modeling.operators.supervised_config import (
    ClassificationModelConfig,
    RegressionModelConfig,
)


class _Constructor(Protocol):
    def __call__(self, **kwargs: object) -> object: ...


def create_boosting(
    algorithm: str,
    config: RegressionModelConfig | ClassificationModelConfig,
    *,
    is_classification: bool,
) -> object:
    """构造有界 CPU 模型；Args: algorithm, config, is_classification。"""
    suffix = "Classifier" if is_classification else "Regressor"
    if algorithm == "xgboost":
        return _construct(
            xgboost,
            f"XGB{suffix}",
            _xgboost_parameters(config, is_classification=is_classification),
        )
    if algorithm == "lightgbm":
        return _construct(
            lightgbm,
            f"LGBM{suffix}",
            _lightgbm_parameters(config, is_classification=is_classification),
        )
    return _construct(
        catboost,
        f"CatBoost{suffix}",
        _catboost_parameters(config, is_classification=is_classification),
    )


def _construct(
    module: ModuleType, name: str, params: Mapping[str, object]
) -> object:
    constructor = cast(_Constructor, getattr(module, name))
    return constructor(**params)


def _xgboost_parameters(
    config: RegressionModelConfig | ClassificationModelConfig,
    *,
    is_classification: bool,
) -> dict[str, object]:
    params: dict[str, object] = {
        "n_estimators": config.n_estimators,
        "learning_rate": config.learning_rate,
        "max_depth": config.max_depth,
        "max_leaves": config.max_leaf_nodes,
        "min_child_weight": config.min_child_weight,
        "reg_alpha": config.boost_l1,
        "reg_lambda": config.boost_l2,
        "gamma": config.min_split_gain,
        "subsample": config.row_subsample,
        "colsample_bytree": config.feature_subsample,
        "random_state": config.random_state,
        "tree_method": "hist",
        "grow_policy": "lossguide",
        "max_bin": 256,
        "device": "cpu",
        "n_jobs": 1,
        "verbosity": 0,
    }
    if not is_classification:
        params["objective"] = "reg:squarederror"
    return params


def _lightgbm_parameters(
    config: RegressionModelConfig | ClassificationModelConfig,
    *,
    is_classification: bool,
) -> dict[str, object]:
    params: dict[str, object] = {
        "n_estimators": config.n_estimators,
        "learning_rate": config.learning_rate,
        "max_depth": config.max_depth,
        "num_leaves": config.max_leaf_nodes,
        "min_child_samples": config.min_samples_leaf,
        "reg_alpha": config.boost_l1,
        "reg_lambda": config.boost_l2,
        "min_split_gain": config.min_split_gain,
        "subsample": config.row_subsample,
        "subsample_freq": 1 if config.row_subsample < 1 else 0,
        "colsample_bytree": config.feature_subsample,
        "random_state": config.random_state,
        "device_type": "cpu",
        "n_jobs": 1,
        "verbosity": -1,
        "deterministic": True,
        "force_col_wise": True,
    }
    if not is_classification:
        params["objective"] = "regression"
    if isinstance(config, ClassificationModelConfig):
        params["class_weight"] = (
            None if config.class_weight == "none" else "balanced"
        )
    return params


def _catboost_parameters(
    config: RegressionModelConfig | ClassificationModelConfig,
    *,
    is_classification: bool,
) -> dict[str, object]:
    params: dict[str, object] = {
        "iterations": config.n_estimators,
        "learning_rate": config.learning_rate,
        "depth": config.catboost_depth,
        "l2_leaf_reg": config.boost_l2,
        "subsample": config.row_subsample,
        "rsm": config.feature_subsample,
        "bootstrap_type": "Bernoulli",
        "random_seed": config.random_state,
        "task_type": "CPU",
        "thread_count": 1,
        "allow_writing_files": False,
        "logging_level": "Silent",
        "use_best_model": False,
        "grow_policy": "SymmetricTree",
    }
    if not is_classification:
        params["loss_function"] = "RMSE"
    if (
        isinstance(config, ClassificationModelConfig)
        and config.class_weight == "balanced"
    ):
        params["auto_class_weights"] = "Balanced"
    return params
