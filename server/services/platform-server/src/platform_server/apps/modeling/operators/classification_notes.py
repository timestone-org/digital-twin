"""指定类与分类汇总的结果说明，不把平均名称当作类别。"""

from collections.abc import Sequence

from platform_server.apps.modeling.operators.evalcurves import (
    BINARY_CLASSES,
    MULTICLASS_NOTE,
    NO_PROBABILITY_NOTE,
)


def positive_note(labels: Sequence[str], positive: str, average: str) -> str:
    """说明P/R/F1的计算对象；Args: labels, positive, average。"""
    if average != "binary":
        return f"{positive}；未定义项不参与均值，F1按各类计数直接计算"
    if positive in labels:
        return f"精确率 / 召回率 / F1 都是相对正类「{positive}」算的"
    return (
        f"正类「{positive}」在这份测试集里一次都没出现过，"
        "精确率与召回率无定义"
    )


def missing_curves_note(
    class_count: int, has_probabilities: bool, average: str
) -> str:
    """说明曲线缺席原因；Args: class_count, has_probabilities, average。"""
    if average != "binary":
        return "当前使用多类汇总，不对应单一正类，因此不展示单类概率曲线。"
    if class_count > BINARY_CLASSES:
        return MULTICLASS_NOTE
    return "" if has_probabilities else NO_PROBABILITY_NOTE
