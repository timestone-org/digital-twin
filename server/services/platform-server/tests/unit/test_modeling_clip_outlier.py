"""离群裁剪：训练期定界、推理期回灌，两侧走同一份参数。

⚠ 这一组反复验的是**上下界只能来自训练行**：拿整帧定界，测试集的信息就进了
训练；拿推理时那一行定界，界就是那个值本身，等于什么都没裁。
"""

from typing import Any

import pytest

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    OperatorError,
    registry,
)
from platform_server.apps.modeling.operators.fitting import (
    PLAN_METHOD,
    PLAN_RANDOM_STATE,
    PLAN_TARGET,
    PLAN_TEST_RATIO,
)

KEY = "读数"


def _frame(values: list[float | None]) -> Frame:
    return Frame(
        columns=(FrameColumn(key=KEY, name=KEY, dtype="number"),),
        rows=tuple((value,) for value in values),
    )


def _built(**config: Any) -> Any:
    operator, _ = registry.build("clip_outlier", config)
    operator.bind_runtime(tz_offset_minutes=0, split_plan=None)
    return operator


def _capped(value: float | None, ceiling: float) -> float:
    """夹回来之后必然小于原值。空值在这里就是用例写错了，不是被测行为。

    Args: value, ceiling。
    """
    assert value is not None
    assert value < ceiling
    return value


def _values(frame: Frame) -> list[float | None]:
    return [value for value in frame.values_of(KEY)]  # noqa: C416


def test_an_outlier_is_pulled_back_to_the_bound() -> None:
    """离群值被夹回上界，其余原样。"""
    operator = _built(method="zscore", threshold=1.0)
    got = operator.run({"frame": _frame([10.0, 11.0, 12.0, 100.0])})["frame"]
    assert _values(got)[:3] == [10.0, 11.0, 12.0]
    _capped(_values(got)[3], 100.0)


def test_a_blank_stays_blank_through_clipping() -> None:
    """空值不参与定界，也不会被夹成某个数。"""
    operator = _built(method="zscore", threshold=2.0)
    got = operator.run({"frame": _frame([1.0, 2.0, 3.0, None])})["frame"]
    assert _values(got)[3] is None


def test_the_iqr_method_uses_the_quartiles() -> None:
    """四分位距那一档定出来的界能把远处那个点夹住。"""
    operator = _built(method="iqr", threshold=1.5)
    rows = [1.0, 2.0, 3.0, 4.0, 5.0, 500.0]
    got = _values(operator.run({"frame": _frame(rows)})["frame"])
    assert got[:5] == rows[:5]
    _capped(got[-1], 500.0)


def test_the_bounds_come_only_from_the_training_rows() -> None:
    """定界只看将来会进训练集的那些行。

    ⚠ 拿整帧定界就是泄漏：测试集里那个离群点会把上界撑大，指标虚高而上线崩。
    """
    plan = {
        PLAN_TARGET: "",
        PLAN_METHOD: "time_order",
        PLAN_TEST_RATIO: 0.5,
        PLAN_RANDOM_STATE: 0,
    }
    operator, _ = registry.build("clip_outlier", {"threshold": 1.0})
    operator.bind_runtime(tz_offset_minutes=0, split_plan=plan)
    operator.run({"frame": _frame([1.0, 2.0, 3.0, 4.0, 900.0, 901.0])})
    bound = (operator.dump_fitted() or {})[KEY]
    assert bound["high"] < 100.0


def test_the_fitted_bounds_round_trip() -> None:
    """训出来的界回灌得进去——校验器不许比生成器严。

    ⚠ 严格度不对齐的表现是「模型训出来了、发布那一刻被自己拒掉」
    （docs/MODELING_DESIGN.md §7.3）。
    """
    trained = _built(threshold=2.0)
    trained.run({"frame": _frame([1.0, 2.0, 3.0, 4.0, 5.0])})
    dumped = trained.dump_fitted() or {}
    loaded = _built(threshold=2.0)
    loaded.load_fitted(dumped)
    assert loaded.dump_fitted() == dumped


def test_a_column_that_cannot_be_bounded_is_refused_by_default() -> None:
    """取值太少定不出界时默认报错，并说清该怎么办。"""
    with pytest.raises(OperatorError, match="定不出上下界"):
        _built(threshold=2.0).run({"frame": _frame([1.0, None])})


def test_that_column_can_be_waved_through_instead() -> None:
    """挑明了要放过时就放过，那一列不记界、推理时也不裁。"""
    operator = _built(threshold=2.0, on_no_bound="skip")
    got = operator.run({"frame": _frame([1.0, None])})["frame"]
    assert _values(got) == [1.0, None]
    assert operator.dump_fitted() == {}


def test_reloading_the_bounds_clips_the_same_way() -> None:
    """回灌之后，推理那一行按训练期的界裁——而不是拿它自己重新定界。

    ⚠ 空参数会让这一步在推理期拿单行重新定界，界就是那个值本身，等于没裁。
    """
    trained = _built(threshold=1.0)
    trained.run({"frame": _frame([10.0, 11.0, 12.0])})
    served = _built(threshold=1.0)
    served.load_fitted(trained.dump_fitted() or {})
    bound = (trained.dump_fitted() or {})[KEY]
    got = _values(served.run({"frame": _frame([999.0])})["frame"])
    assert got[0] == pytest.approx(bound["high"])


def test_bounds_that_are_the_wrong_way_round_are_refused() -> None:
    """下界比上界还大的一份参数当场拒掉，不硬算。"""
    with pytest.raises(OperatorError, match="下界"):
        _built(threshold=1.0).load_fitted({KEY: {"low": 9.0, "high": 1.0}})
