"""发布时冻结哪一份指标：判据必须连算子一起看，不能只认端口名。

⚠ 五个评估算子的输出端口全叫 `metrics`，只认端口的话，一条同时挂了回归评估与
残差分析的图会把残差五统计量冻成模型指标，取到哪一个还取决于迭代顺序
（docs/MODELING_RESULT_VIEW_DESIGN.md R-19 / Q4）。
"""

from typing import Any

from platform_server.apps.modeling.schemas.graph import (
    GraphNode,
    PipelineGraph,
)
from platform_server.apps.modeling.services.entry_contract import NodeRecord
from platform_server.apps.modeling.services.model_service import _metrics_of

REGRESSION = {"r2": 0.93, "rmse": 1.2}
RESIDUALS = {"residual_mean": -0.4, "residual_std": 1.1}
FOLDS = {"folds": 3.0, "score_mean": 0.8}


def graph_of(*nodes: tuple[str, str]) -> PipelineGraph:
    """按 (节点 id, 算子 code) 造一张只有节点的图。

    Args: nodes。
    """
    return PipelineGraph(
        nodes=[
            GraphNode(id=node_id, operator=operator)
            for node_id, operator in nodes
        ]
    )


def record_of(metrics: dict[str, Any]) -> NodeRecord:
    """造一条带评估摘要的节点记录。

    Args: metrics。
    """
    return NodeRecord(
        preview={"metrics": {"kind": "metrics", "metrics": metrics}},
        fitted=None,
        io={},
    )


def test_the_frozen_metrics_come_from_the_evaluation_operator() -> None:
    """只有回归评估与分类评估的那一份算「这个模型好不好」。"""
    graph = graph_of(("a", "residual_analysis"), ("b", "regression_metrics"))
    records = {"a": record_of(RESIDUALS), "b": record_of(REGRESSION)}
    assert _metrics_of(graph, records) == REGRESSION


def test_a_residual_step_in_front_no_longer_wins_the_race() -> None:
    """⚠ 残差分析排在评估算子前面时，冻的仍是 R²/RMSE 那一份。

    只认端口名的判据在这里会冻出偏均值与离散度，而模型库详情页照旧把它们摆在
    「模型指标」那一栏，没有一个字说这不是模型的分。
    """
    graph = graph_of(("a", "residual_analysis"), ("b", "regression_metrics"))
    records = {"a": record_of(RESIDUALS), "b": record_of(REGRESSION)}
    assert "residual_mean" not in _metrics_of(graph, records)


def test_a_cross_validation_step_is_not_the_model_score_either() -> None:
    """交叉验证的四个标量也不是模型指标：一条只挂它的图冻出空字典。"""
    graph = graph_of(("a", "cross_validate"))
    assert _metrics_of(graph, {"a": record_of(FOLDS)}) == {}


def test_an_empty_metrics_dictionary_lets_the_next_one_win() -> None:
    """⚠ 特征重要性的 metrics 已经搬空：它不该把后面那个评估节点挡住。"""
    graph = graph_of(
        ("a", "feature_importance"),
        ("b", "classification_metrics"),
    )
    records = {"a": record_of({}), "b": record_of({"accuracy": 0.88})}
    assert _metrics_of(graph, records) == {"accuracy": 0.88}


def test_an_evaluation_node_without_a_record_is_skipped() -> None:
    """图上有评估节点但那一步没跑成：跳过它接着找，不抛。"""
    graph = graph_of(("a", "regression_metrics"), ("b", "regression_metrics"))
    assert _metrics_of(graph, {"b": record_of(REGRESSION)}) == REGRESSION


def test_a_graph_without_any_evaluation_step_freezes_nothing() -> None:
    """找不到评估节点时给空字典，不编数。"""
    graph = graph_of(("a", "linear_regression"))
    assert _metrics_of(graph, {"a": record_of(REGRESSION)}) == {}
