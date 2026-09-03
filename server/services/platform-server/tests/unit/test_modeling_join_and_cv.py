"""多台账对齐与交叉验证。

⚠ 两条都与「看着正常的错数」有关：按行号并两张周期不同的台账，每一行都是错的
而每个数都正常；等分 K 折在时序数据上会拿未来的行去训过去的行，指标虚高。
"""

from typing import Any

import pytest

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    MetricsPayload,
    OperatorError,
    registry,
)
from platform_server.apps.modeling.operators.frame import (
    ROLE_FEATURE,
    ROLE_TARGET,
)
from platform_server.apps.modeling.operators.payloads import ModelPayload

LEFT_KEY = "温度"
RIGHT_KEY = "湿度"
TARGET = "能耗"
SECOND = 1000


def _sided(key: str, values: list[float], moments: list[int]) -> Frame:
    """一列数值 + 时间索引。

    Args: key, values, moments。
    """
    return Frame(
        columns=(FrameColumn(key=key, name=key, dtype="number"),),
        rows=tuple((value,) for value in values),
        index=tuple(moments),
    )


def _joined(left: Frame, right: Frame, **config: Any) -> Frame:
    operator, _ = registry.build("ledger_join", config)
    operator.bind_runtime(tz_offset_minutes=0, split_plan=None)
    produced = operator.run({"left": left, "right": right})["frame"]
    assert isinstance(produced, Frame)
    return produced


def test_rows_align_by_moment_not_by_position() -> None:
    """按时刻就近对齐，不按行号。

    ⚠ 两张台账的采集周期常常不同，按行号并起来的每一行都是错的。
    """
    left = _sided(LEFT_KEY, [1.0, 2.0], [0, 10 * SECOND])
    right = _sided(RIGHT_KEY, [90.0, 80.0], [10 * SECOND, 0])
    got = _joined(left, right, tolerance_ms=SECOND)
    assert got.values_of(f"右_{RIGHT_KEY}") == [80.0, 90.0]


def test_a_row_outside_the_tolerance_is_dropped_by_default() -> None:
    """超出容差的那一行默认丢掉。"""
    left = _sided(LEFT_KEY, [1.0, 2.0], [0, 10 * SECOND])
    right = _sided(RIGHT_KEY, [90.0], [0])
    got = _joined(left, right, tolerance_ms=SECOND, how="inner")
    assert got.row_count == 1


def test_it_can_keep_the_left_row_with_blanks_instead() -> None:
    """以左边为准时那一行留着，右边那几列是空值——不是 0。"""
    left = _sided(LEFT_KEY, [1.0, 2.0], [0, 10 * SECOND])
    right = _sided(RIGHT_KEY, [90.0], [0])
    got = _joined(left, right, tolerance_ms=SECOND, how="left")
    assert got.values_of(f"右_{RIGHT_KEY}") == [90.0, None]


def test_the_right_side_columns_are_prefixed() -> None:
    """右边每一列都加前缀，声明与实跑一致。"""
    left = _sided(LEFT_KEY, [1.0], [0])
    right = _sided(RIGHT_KEY, [90.0], [0])
    got = _joined(left, right)
    assert got.keys == (LEFT_KEY, f"右_{RIGHT_KEY}")

    operator = registry.get("ledger_join")
    declared = operator.describe_columns(
        operator.CONFIG_MODEL(),
        {"left": (LEFT_KEY,), "right": (RIGHT_KEY,)},
    )
    assert declared["frame"] == got.keys


def test_a_prefix_that_still_clashes_is_refused() -> None:
    """加完前缀仍撞名时当场说清楚，不静默覆盖。"""
    left = _sided(f"右_{RIGHT_KEY}", [1.0], [0])
    right = _sided(RIGHT_KEY, [90.0], [0])
    with pytest.raises(OperatorError, match="撞名"):
        _joined(left, right)


def test_nothing_matching_is_an_error_not_an_empty_frame() -> None:
    """一行都对不上时报错，不交一份空帧下去。"""
    left = _sided(LEFT_KEY, [1.0], [0])
    right = _sided(RIGHT_KEY, [90.0], [999 * SECOND])
    with pytest.raises(OperatorError, match="对不上"):
        _joined(left, right, tolerance_ms=SECOND, how="inner")


def _training(rows: int = 40) -> Frame:
    """一列特征、一列严格线性的目标。

    Args: rows。
    """
    return Frame(
        columns=(
            FrameColumn(
                key=LEFT_KEY, name=LEFT_KEY, dtype="number", role=ROLE_FEATURE
            ),
            FrameColumn(
                key=TARGET, name=TARGET, dtype="number", role=ROLE_TARGET
            ),
        ),
        rows=tuple(
            (float(index), float(index) * 2.0 + 1.0) for index in range(rows)
        ),
    )


def _model_of(frame: Frame) -> ModelPayload:
    operator, _ = registry.build("linear_regression", {})
    operator.bind_runtime(tz_offset_minutes=0, split_plan=None)
    payload = operator.run({"train": frame, "test": frame})["model"]
    assert isinstance(payload, ModelPayload)
    return payload


def _validated(frame: Frame, **config: Any) -> MetricsPayload:
    operator, _ = registry.build("cross_validate", config)
    operator.bind_runtime(tz_offset_minutes=0, split_plan=None)
    payload = operator.run({"model": _model_of(frame), "frame": frame})[
        "metrics"
    ]
    assert isinstance(payload, MetricsPayload)
    return payload


def test_a_clean_relation_scores_well_on_every_fold() -> None:
    """严格线性的数据在每一折上都拟合得很好，波动接近 0。"""
    got = _validated(_training(), folds=4)
    mean = got.metrics["score_mean"]
    std = got.metrics["score_std"]
    assert mean is not None
    assert std is not None
    assert mean > 0.99
    assert std < 0.01


def test_forward_chaining_leaves_out_the_first_block() -> None:
    """前向链只出「折数减一」折——第一块没有更早的行可以训。"""
    got = _validated(_training(), folds=4, method="forward_chain")
    assert got.metrics["folds"] == pytest.approx(3.0)


def test_plain_kfold_uses_every_block_as_a_test_set() -> None:
    """等分 K 折每一块都当过一次测试集。

    ⚠ 它在时序数据上会拿未来的行去训过去的行，指标虚高——所以不是默认。
    """
    got = _validated(_training(), folds=4, method="kfold")
    assert got.metrics["folds"] == pytest.approx(4.0)


def test_too_few_rows_for_the_folds_is_refused() -> None:
    """行数不够切那么多折时说清楚该怎么办。"""
    with pytest.raises(OperatorError, match="切不出"):
        _validated(_training(rows=3), folds=10)


def test_the_worst_fold_is_reported_too() -> None:
    """最差的那一折单独给出来——只看均值看不出「对切在哪儿很敏感」。"""
    got = _validated(_training(), folds=4)
    worst = got.metrics["score_worst"]
    mean = got.metrics["score_mean"]
    assert worst is not None
    assert mean is not None
    assert worst <= mean
