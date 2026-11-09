"""通用监督模型的训练口径、真实测试分与收敛提示。"""

import math
from dataclasses import dataclass

from platform_server.apps.modeling.operators.reporting import (
    NOTE_ALERT,
    NOTE_HINT,
    BlockAt,
    ReportBlock,
    Scale,
    annotated,
    breakdown_block,
)

# 拟合概况上那句口径说明
FROZEN_HINT = "模型冻结后可发布；测试数据不参与训练或标准化拟合"


@dataclass(frozen=True)
class SupervisedRun:
    """监督拟合实际使用的样本、算法和告警。"""

    algorithm_name: str
    training_rows: int
    feature_count: int
    truth: tuple[float, ...]
    predicted: tuple[float, ...]
    is_classification: bool
    should_standardize: bool
    notices: tuple[str, ...]
    class_count: int = 0


def supervised_blocks(seen: SupervisedRun) -> tuple[ReportBlock, ...]:
    """展示拟合规模、评分和真正发生的告警。Args: seen。"""
    gist = breakdown_block(
        BlockAt(zone="step", title="监督模型拟合概况"),
        Scale(label=seen.algorithm_name),
        [
            {
                "key": "training_rows",
                "label": "训练行数",
                "value": seen.training_rows,
            },
            {"key": "test_rows", "label": "测试行数", "value": len(seen.truth)},
            {"key": "features", "label": "特征数", "value": seen.feature_count},
            {"key": "classes", "label": "类别数", "value": seen.class_count},
            {
                "key": "scaling",
                "label": "训练集内标准化",
                "value": 1 if seen.should_standardize else 0,
            },
        ],
    )
    gist = annotated(
        annotated(gist, NOTE_HINT, (FROZEN_HINT,)), NOTE_ALERT, seen.notices
    )
    score = _test_score(seen)
    metric = "测试准确率" if seen.is_classification else "测试均方根误差"
    evaluation = breakdown_block(
        BlockAt(zone="stats", title="留出测试集表现"),
        Scale(label=metric),
        [{"key": "score", "label": metric, "value": score}],
    )
    return (gist, evaluation)


def _test_score(seen: SupervisedRun) -> float | None:
    if not seen.truth:
        return None
    if seen.is_classification:
        return sum(
            actual == guess
            for actual, guess in zip(seen.truth, seen.predicted, strict=True)
        ) / len(seen.truth)
    differences = [
        actual - guess
        for actual, guess in zip(seen.truth, seen.predicted, strict=True)
    ]
    if not all(math.isfinite(value) for value in differences):
        return None
    scale = max(abs(value) for value in differences)
    if scale == 0:
        return 0.0
    value = (
        math.sqrt(
            math.fsum(
                (item / scale) ** 2 / len(differences) for item in differences
            )
        )
        * scale
    )
    return value if math.isfinite(value) else None
