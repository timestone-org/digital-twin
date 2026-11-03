"""监督、聚类与异常模型族的全目录真实输入。"""

from typing import Any

from unit.anomaly_fakes import training_pair

from platform_server.apps.modeling.operators import Frame
from platform_server.apps.modeling.operators.frame import with_roles

type Case = tuple[dict[str, Any], dict[str, Any]]


def family_cases(source: Frame, classified: Frame) -> dict[str, Case]:
    """准备各模型族可执行的最小输入。Args: source, classified。"""
    roled = with_roles(source, target_key="能耗")
    return {
        "regression_model": ({"train": roled, "test": roled}, {}),
        "classification_model": ({"train": classified, "test": classified}, {}),
        "clustering_analysis": ({"frame": roled}, {}),
        "anomaly_model": (training_pair(), {"n_estimators": 20}),
    }


def family_loads(pool: dict[str, Frame]) -> dict[str, tuple[Case, ...]]:
    """复用宽帧、长列名与真实正常工况序列。Args: pool。"""
    return {
        "regression_model": (
            ({"train": pool["is_dense"], "test": pool["is_dense"]}, {}),
        ),
        "classification_model": (
            (
                {"train": pool["labelled"], "test": pool["labelled"]},
                {"algorithm": "decision_tree"},
            ),
        ),
        "clustering_analysis": (
            ({"frame": pool["anomaly_train"]}, {"n_clusters": 12}),
        ),
        "anomaly_model": (
            (
                {"train": pool["anomaly_train"], "test": pool["anomaly_test"]},
                {"n_estimators": 20},
            ),
        ),
    }
