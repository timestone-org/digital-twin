"""监督模型的固定数值回归与三类小数标签样本。"""

import numpy as np

from platform_server.apps.modeling.operators import Frame, FrameColumn


def samples(
    *, is_classification: bool, classes: int = 3
) -> tuple[Frame, Frame]:
    """按固定种子生成独立的训练与测试样本。Args: is_classification, classes。"""
    generator = np.random.default_rng(42)
    rows: list[tuple[float, float, float]] = []
    labels = (-2.5, 1.5, 4.5)
    for seat in range(120):
        group = seat % classes
        first = float(generator.normal(group * 3, 0.5))
        second = float(generator.normal(group * -2, 0.7))
        target = (
            labels[group] if is_classification else 3 * first - 2 * second + 5
        )
        rows.append((first, second, target))
    columns = (
        FrameColumn(key="first", name="第一特征", dtype="number"),
        FrameColumn(key="second", name="第二特征", dtype="number"),
        FrameColumn(key="target", name="目标", dtype="number", role="target"),
    )
    return (
        Frame(columns=columns, rows=tuple(rows[:90]), index=tuple(range(90))),
        Frame(
            columns=columns, rows=tuple(rows[90:]), index=tuple(range(90, 120))
        ),
    )
