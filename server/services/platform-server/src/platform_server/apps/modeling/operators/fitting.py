"""带拟合的算子共用的两件事：在哪些行上拟合、拟合哪些列。

⚠ 统计量若在整帧上算，测试集的信息就进了训练——指标虚高而上线崩，且没有任何
一处会报错。所以带拟合的算子一律只看「将来会进训练集」的那些行，切法与切分
算子共用同一份（docs/MODELING_DESIGN.md §5.3）。
"""

from typing import Any

from platform_server.apps.modeling.operators.frame import (
    Frame,
    numeric_keys,
    select_rows,
    split_row_indices,
)

# 引擎从图里的切分节点提取出来、注入给上游带拟合算子的四个键
PLAN_TARGET = "target_column"
PLAN_METHOD = "method"
PLAN_TEST_RATIO = "test_ratio"
PLAN_RANDOM_STATE = "random_state"


def training_frame(frame: Frame, split_plan: dict[str, Any] | None) -> Frame:
    """只留下将来会进训练集的那些行。图里没有切分时用整帧。

    Args: frame, split_plan。
    """
    if split_plan is None:
        return frame
    train, _ = split_row_indices(
        frame.row_count,
        method=str(split_plan[PLAN_METHOD]),
        test_ratio=float(split_plan[PLAN_TEST_RATIO]),
        random_state=int(split_plan[PLAN_RANDOM_STATE]),
    )
    return select_rows(frame, sorted(train))


def fit_columns(
    frame: Frame, configured: list[str], split_plan: dict[str, Any] | None
) -> tuple[str, ...]:
    """这一步要处理哪几列。

    ⚠ 留空时默认全部数值列**但排除目标列**：把目标列一起标准化 / 填充，
    预测出来的数就不在原尺度上了，而结果看着完全正常。
    Args: frame, configured, split_plan。
    """
    if configured:
        for key in configured:
            frame.position_of(key)
        return tuple(configured)
    target = None if split_plan is None else str(split_plan[PLAN_TARGET])
    return tuple(key for key in numeric_keys(frame) if key != target)
