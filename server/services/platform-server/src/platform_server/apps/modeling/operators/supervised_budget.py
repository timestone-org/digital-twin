"""按树数、叶子上限与类别数预检监督模型内存规模。"""

from platform_server.apps.modeling.operators.base import OperatorError
from platform_server.apps.modeling.operators.supervised_config import (
    TREE_ALGORITHMS,
    ClassificationModelConfig,
    RegressionModelConfig,
)

MAX_TREE_LEAF_VALUES = 250_000
TREE_MODEL_ALGORITHMS = frozenset(
    (*TREE_ALGORITHMS, "xgboost", "lightgbm", "catboost")
)


def check_tree_budget(
    config: RegressionModelConfig | ClassificationModelConfig,
    *,
    class_count: int,
) -> None:
    """拟合前约束参数组合的叶值上限。Args: config, class_count。"""
    if config.algorithm not in TREE_MODEL_ALGORITHMS:
        return
    leaves = (
        (1 << config.catboost_depth)
        if config.algorithm == "catboost"
        else min(config.max_leaf_nodes, 1 << config.max_depth)
    )
    if config.algorithm == "decision_tree":
        trees = 1
    elif config.algorithm == "hist_gradient_boosting":
        trees = config.boosting_iterations
    else:
        trees = config.n_estimators
    if trees * leaves * max(1, class_count) > MAX_TREE_LEAF_VALUES:
        raise OperatorError(
            "参数组合超出训练资源预算，请降低树数量、深度或最大叶子数；多分类时也可先合并过细的类别"
        )
