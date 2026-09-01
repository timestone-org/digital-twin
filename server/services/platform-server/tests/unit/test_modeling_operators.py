"""六个 P0 算子的用例。零 DB、零 fixture——算子是纯函数，这是刻意的红利。"""

import pytest

from platform_server.apps.modeling.operators import (
    PREFETCHED_KEY,
    Frame,
    FrameColumn,
    OperatorError,
    registry,
)
from platform_server.apps.modeling.operators.frame import split_row_indices
from unit.modeling_fakes import (
    INTERCEPT,
    SLOPE_LOAD,
    SLOPE_TEMP,
    linear_frame,
    with_hole,
)

# 三个下游算子共用的切分计划，与 `split_dataset` 的默认参数一致
PLAN = {
    "target_column": "能耗",
    "method": "time_order",
    "test_ratio": 0.2,
    "random_state": 42,
}


def build(code: str, **config: object):
    """按 code 造一个绑好运行期上下文的算子。

    Args: code, config。
    """
    operator, _ = registry.build(code, dict(config))
    operator.bind_runtime(tz_offset_minutes=480, split_plan=PLAN)
    return operator


def test_source_passes_through_the_prefetched_frame() -> None:
    """取数算子只把引擎预取好的帧交出去——它跑在没有数据库连接的地方。"""
    frame = linear_frame(10)
    operator = build("ledger_source", table_code="energy_h")
    assert operator.run({PREFETCHED_KEY: frame})["frame"] is frame


def test_source_without_prefetched_frame_complains() -> None:
    """引擎没准备数据时明说，不返回一个空帧让下游算出一堆空。"""
    operator = build("ledger_source", table_code="energy_h")
    with pytest.raises(OperatorError):
        operator.run({})


def test_fill_missing_fits_on_training_rows_only() -> None:
    """填充值只在训练行上算：测试行参与拟合就是泄漏，而且不报任何错。"""
    frame = linear_frame(100)
    train_indices, _ = split_row_indices(
        100, method="time_order", test_ratio=0.2, random_state=42
    )
    # ⚠ 挖掉的那一行本身也在训练行里，均值当然要把它排除在外
    present = [index for index in train_indices if index != 0]
    expected = sum(
        float(frame.rows[index][0] or 0.0) for index in present
    ) / len(present)
    operator = build("fill_missing")
    operator.run({"frame": with_hole(frame, row=0, key="温度")})
    fitted = operator.dump_fitted() or {}
    assert fitted["温度"] == pytest.approx(expected)


def test_fill_missing_uses_whole_frame_without_a_split() -> None:
    """图里没有切分时用整帧——这也是单测直跑算子的口径。"""
    frame = linear_frame(20)
    operator, _ = registry.build("fill_missing", {})
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    operator.run({"frame": frame})
    whole = sum(float(row[0] or 0.0) for row in frame.rows) / frame.row_count
    assert (operator.dump_fitted() or {})["温度"] == pytest.approx(whole)


def test_fill_missing_excludes_the_target_column_by_default() -> None:
    """留空时默认不碰目标列：填了它，预测出来的数就不在原尺度上。"""
    operator = build("fill_missing")
    operator.run({"frame": linear_frame(20)})
    assert set(operator.dump_fitted() or {}) == {"温度", "负荷"}


def test_fill_missing_replays_loaded_values() -> None:
    """推理时用回灌的那份，不重新算——训练与线上必须是同一个数。"""
    operator = build("fill_missing")
    operator.load_fitted({"温度": 111.0})
    holed = with_hole(linear_frame(5), row=0, key="温度")
    assert operator.run({"frame": holed})["frame"].rows[0][0] == 111.0


def test_fill_missing_rejects_an_all_empty_column() -> None:
    """整列皆空时均值算不出来，明说而不是悄悄填 0。"""
    frame = Frame(
        columns=(FrameColumn(key="温度", name="温度", dtype="number"),),
        rows=((None,), (None,)),
    )
    operator, _ = registry.build("fill_missing", {"columns": ["温度"]})
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    with pytest.raises(OperatorError):
        operator.run({"frame": frame})


def test_standardize_keys_its_stats_by_column_key() -> None:
    """尺度参数按**列 key** 建键，绝不按列索引——按索引是无告警的错误预测。"""
    operator = build("standardize")
    operator.run({"frame": linear_frame(50)})
    fitted = operator.dump_fitted() or {}
    assert set(fitted) == {"温度", "负荷"}
    assert set(fitted["温度"]) == {"center", "scale"}


def test_standardize_round_trips_its_fitted_params() -> None:
    """导出再回灌必须还原同一个变换。"""
    operator = build("standardize")
    first = operator.run({"frame": linear_frame(50)})["frame"]
    replayed = build("standardize")
    replayed.load_fitted(operator.dump_fitted() or {})
    second = replayed.run({"frame": linear_frame(50)})["frame"]
    assert first.rows == second.rows


def test_standardize_rejects_a_constant_column_at_fit_time() -> None:
    """常量列在**拟合期**就拒绝：留到推理期才抛就是训得出来、上线才炸。"""
    frame = Frame(
        columns=(FrameColumn(key="温度", name="温度", dtype="number"),),
        rows=((7.0,), (7.0,), (7.0,)),
    )
    operator, _ = registry.build("standardize", {"columns": ["温度"]})
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    with pytest.raises(OperatorError):
        operator.run({"frame": frame})


def test_split_marks_roles_and_keeps_time_order() -> None:
    """切分打列角色，且默认按时序切——随机切会把未来泄给训练集。"""
    operator = build("split_dataset", target_column="能耗")
    parts = operator.run({"frame": linear_frame(100)})
    assert parts["train"].row_count == 80
    assert parts["test"].row_count == 20
    assert parts["train"].keys_by_role("target") == ("能耗",)
    assert parts["train"].keys_by_role("feature") == ("温度", "负荷")
    assert parts["train"].index is not None
    assert parts["test"].index is not None
    assert max(parts["train"].index) < min(parts["test"].index)


def test_split_rejects_a_non_numeric_target() -> None:
    """目标列必须是数值列。"""
    frame = Frame(
        columns=(
            FrameColumn(key="标签", name="标签", dtype="string"),
            FrameColumn(key="值", name="值", dtype="number"),
        ),
        rows=(("甲", 1.0), ("乙", 2.0)),
    )
    operator = build("split_dataset", target_column="标签")
    with pytest.raises(OperatorError):
        operator.run({"frame": frame})


def test_the_fitted_line_recovers_the_true_coefficients() -> None:
    """在没有标准化的原始尺度上，学出来的系数必须等于造数时那三个。"""
    operator = build("split_dataset", target_column="能耗")
    parts = operator.run({"frame": linear_frame(100)})
    model = build("linear_regression")
    payload = model.run({"train": parts["train"], "test": parts["test"]})
    coef = payload["model"].fitted["coef"]
    assert coef["温度"] == pytest.approx(SLOPE_TEMP)
    assert coef["负荷"] == pytest.approx(SLOPE_LOAD)
    assert payload["model"].fitted["intercept"] == pytest.approx(INTERCEPT)


def test_the_model_step_scores_the_test_set() -> None:
    """打分帧是两列：真实值与预测值，行数与测试集一致。"""
    parts = build("split_dataset", target_column="能耗").run(
        {"frame": linear_frame(50)}
    )
    scored = build("linear_regression").run(
        {"train": parts["train"], "test": parts["test"]}
    )["scored"]
    assert scored.keys == ("y_true", "y_pred")
    assert scored.row_count == parts["test"].row_count


def test_coefficients_keyed_by_index_are_rejected() -> None:
    """回灌时按列下标建的键一律拒绝。"""
    with pytest.raises(OperatorError):
        build("linear_regression").load_fitted(
            {"coef": {0: 1.0}, "intercept": 0.0}
        )


def test_metrics_are_perfect_on_a_strictly_linear_relation() -> None:
    """严格线性的数据上 R² 恰为 1、误差恰为 0——不是「差不多」。"""
    parts = build("split_dataset", target_column="能耗").run(
        {"frame": linear_frame(50)}
    )
    scored = build("linear_regression").run(
        {"train": parts["train"], "test": parts["test"]}
    )["scored"]
    metrics = build("regression_metrics").run({"scored": scored})["metrics"]
    assert metrics.metrics["r2"] == pytest.approx(1.0)
    assert metrics.metrics["rmse"] == pytest.approx(0.0, abs=1e-6)
    assert metrics.metrics["max_error"] == pytest.approx(0.0, abs=1e-6)


def test_metrics_report_none_when_r2_is_undefined() -> None:
    """真实值没有离散度时 R² 无定义，给 None 而不是一个假的 0。"""
    scored = Frame(
        columns=(
            FrameColumn(key="y_true", name="真实值", dtype="number"),
            FrameColumn(key="y_pred", name="预测值", dtype="number"),
        ),
        rows=((5.0, 5.0), (5.0, 5.0)),
    )
    metrics = build("regression_metrics").run({"scored": scored})["metrics"]
    assert metrics.metrics["r2"] is None
