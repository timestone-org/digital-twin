"""六个 P0 算子的用例。零 DB、零 fixture——算子是纯函数，这是刻意的红利。"""

import numpy as np
import pytest

from platform_server.apps.modeling.operators import (
    PREFETCHED_KEY,
    CellValue,
    Frame,
    FrameColumn,
    OperatorError,
    registry,
)
from platform_server.apps.modeling.operators.estimators import LeastSquares
from platform_server.apps.modeling.operators.frame import (
    numbers_of,
    split_row_indices,
)
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


def numeric_frame(
    keys: tuple[str, ...], rows: tuple[tuple[CellValue, ...], ...]
) -> Frame:
    """造一份全是数值列的帧。

    Args: keys, rows。
    """
    return Frame(
        columns=tuple(
            FrameColumn(key=key, name=key, dtype="number") for key in keys
        ),
        rows=rows,
    )


def scored_frame(count: int) -> Frame:
    """造一份打分帧，残差随行号线性拉开。

    Args: count。
    """
    return numeric_frame(
        ("y_true", "y_pred"),
        tuple((float(index), index * 0.9) for index in range(count)),
    )


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


def test_source_keeps_an_all_empty_column_by_default() -> None:
    """默认不丢列：丢列会让下游引用它的步骤在运行期突然找不到列。"""
    frame = numeric_frame(("温度", "负荷"), ((None, 1.0), (None, 2.0)))
    operator = build("ledger_source", table_code="energy_h")
    assert operator.run({PREFETCHED_KEY: frame})["frame"].keys == (
        "温度",
        "负荷",
    )


def test_source_drops_columns_that_are_empty_over_the_window() -> None:
    """打开后，这段时间里一个值都没有的列不往下走，其余列原样保留。"""
    frame = numeric_frame(("温度", "负荷"), ((None, 1.0), (None, 2.0)))
    operator = build(
        "ledger_source",
        table_code="energy_h",
        should_drop_empty_columns=True,
    )
    produced = operator.run({PREFETCHED_KEY: frame})["frame"]
    assert produced.keys == ("负荷",)
    assert produced.rows == ((1.0,), (2.0,))


def test_source_keeps_its_columns_when_there_are_no_rows() -> None:
    """一行都没有时不判空列：那会把「这段时间没数据」说成「每一列都是空的」。"""
    frame = numeric_frame(("温度", "负荷"), ())
    operator = build(
        "ledger_source",
        table_code="energy_h",
        should_drop_empty_columns=True,
    )
    assert operator.run({PREFETCHED_KEY: frame})["frame"].keys == (
        "温度",
        "负荷",
    )


def test_source_complains_when_every_column_is_empty() -> None:
    """丢光了就明说，不把一份零列的帧交给下游。"""
    frame = numeric_frame(("温度", "负荷"), ((None, None), (None, None)))
    operator = build(
        "ledger_source",
        table_code="energy_h",
        should_drop_empty_columns=True,
    )
    with pytest.raises(OperatorError):
        operator.run({PREFETCHED_KEY: frame})


def test_fill_missing_leaves_an_all_null_column_alone_when_told_to() -> None:
    """skip 那一档不给整列全空的列记填充值，这一列原样往下走。"""
    frame = numeric_frame(
        ("温度", "负荷"), ((None, 1.0), (None, None), (None, 3.0))
    )
    operator, _ = registry.build("fill_missing", {"on_all_null": "skip"})
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    produced = operator.run({"frame": frame})["frame"]
    assert (operator.dump_fitted() or {}) == {"负荷": 2.0}
    assert produced.values_of("温度") == [None, None, None]
    assert produced.values_of("负荷") == [1.0, 2.0, 3.0]


def test_the_constant_strategy_fills_an_all_null_column() -> None:
    """固定值填法本来就填得出整列全空的列，默认档照填不误。"""
    frame = numeric_frame(("温度",), ((None,), (None,)))
    operator, _ = registry.build(
        "fill_missing", {"strategy": "constant", "value": 7.0}
    )
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    produced = operator.run({"frame": frame})["frame"]
    assert produced.values_of("温度") == [7.0, 7.0]


def test_the_skip_setting_also_holds_for_the_constant_strategy() -> None:
    """选了 skip 就一律放过，不因为填法换成固定值又填回去。"""
    frame = numeric_frame(("温度",), ((None,), (None,)))
    operator, _ = registry.build(
        "fill_missing",
        {"strategy": "constant", "value": 7.0, "on_all_null": "skip"},
    )
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    produced = operator.run({"frame": frame})["frame"]
    assert (operator.dump_fitted() or {}) == {}
    assert produced.values_of("温度") == [None, None]


def test_standardize_leaves_a_constant_column_alone_when_told_to() -> None:
    """skip 那一档不给常量列记尺度，这一列原样往下走，其余列照缩放。"""
    frame = numeric_frame(
        ("温度", "负荷"), ((7.0, 1.0), (7.0, 2.0), (7.0, 3.0))
    )
    operator, _ = registry.build("standardize", {"on_constant_column": "skip"})
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    produced = operator.run({"frame": frame})["frame"]
    assert set(operator.dump_fitted() or {}) == {"负荷"}
    assert produced.values_of("温度") == [7.0, 7.0, 7.0]
    assert produced.values_of("负荷")[1] == pytest.approx(0.0)


def test_split_keeps_a_single_test_row_by_default() -> None:
    """默认下限是一行：三行数据按两成切也留得下一行测试集。"""
    operator = build("split_dataset", target_column="能耗")
    parts = operator.run({"frame": linear_frame(3)})
    assert parts["test"].row_count == 1


def test_split_rejects_a_test_set_below_the_floor() -> None:
    """够不上下限时当场报错，并说清行数与比例各是多少。"""
    operator = build("split_dataset", target_column="能耗", min_test_rows=5)
    with pytest.raises(OperatorError) as caught:
        operator.run({"frame": linear_frame(10)})
    assert "2 行" in str(caught.value)
    assert "20%" in str(caught.value)


def test_the_unregularized_fit_recovers_the_closed_form_solution() -> None:
    """不加正则时解就是最小二乘的闭式解，alpha 填了也不参与。"""
    parts = build("split_dataset", target_column="能耗").run(
        {"frame": linear_frame(100)}
    )
    model = build("linear_regression", regularization="none", ridge_alpha=9.0)
    fitted = model.run({"train": parts["train"], "test": parts["test"]})[
        "model"
    ].fitted
    assert fitted["coef"]["温度"] == pytest.approx(SLOPE_TEMP)
    assert fitted["coef"]["负荷"] == pytest.approx(SLOPE_LOAD)
    assert fitted["intercept"] == pytest.approx(INTERCEPT)


def test_a_positive_alpha_shrinks_the_coefficients() -> None:
    """岭回归把系数往 0 收，收多少由 alpha 定。"""
    parts = build("split_dataset", target_column="能耗").run(
        {"frame": linear_frame(100)}
    )
    ridge = build("linear_regression", regularization="ridge", ridge_alpha=50.0)
    fitted = ridge.run({"train": parts["train"], "test": parts["test"]})[
        "model"
    ].fitted
    assert 0.0 < fitted["coef"]["温度"] < SLOPE_TEMP
    assert 0.0 < fitted["coef"]["负荷"] < SLOPE_LOAD


def test_the_ridge_penalty_leaves_the_intercept_out() -> None:
    """alpha 大到系数几乎归零时，截距仍是训练集目标列的均值而不是 0。"""
    parts = build("split_dataset", target_column="能耗").run(
        {"frame": linear_frame(100)}
    )
    train = parts["train"]
    ridge = build("linear_regression", regularization="ridge", ridge_alpha=1e12)
    fitted = ridge.run({"train": train, "test": parts["test"]})["model"].fitted
    target = [float(value or 0.0) for value in numbers_of(train, "能耗")]
    assert fitted["coef"]["温度"] == pytest.approx(0.0, abs=1e-3)
    assert fitted["intercept"] == pytest.approx(
        sum(target) / len(target), rel=1e-6
    )


def test_a_ridge_model_keeps_the_coef_and_intercept_shape() -> None:
    """拟合参数的形状不随正则化变——变了线上那份就读不出来了。"""
    parts = build("split_dataset", target_column="能耗").run(
        {"frame": linear_frame(50)}
    )
    ridge = build("linear_regression", regularization="ridge", ridge_alpha=1.0)
    payload = ridge.run({"train": parts["train"], "test": parts["test"]})
    fitted = payload["model"].fitted
    assert set(fitted) == {"coef", "intercept"}
    registry.get("linear_regression").validate_fitted(fitted)
    assert payload["model"].hyper_params["ridge_alpha"] == 1.0


def test_the_residual_histogram_defaults_to_twenty_buckets() -> None:
    """默认二十个桶、五百个散点，且没到上限时不标已截断。"""
    metrics = build("regression_metrics").run({"scored": scored_frame(60)})[
        "metrics"
    ]
    assert len(metrics.residual_bins) == 20
    assert len(metrics.pairs) == 60
    assert metrics.is_truncated is False


def test_the_residual_bucket_count_follows_the_parameter() -> None:
    """桶数由参数定。"""
    metrics = build("regression_metrics", residual_bins=5).run(
        {"scored": scored_frame(60)}
    )["metrics"]
    assert len(metrics.residual_bins) == 5


def test_the_scatter_cap_truncates_and_says_so() -> None:
    """散点超过上限时截断，并如实标注，不悄悄少给几个点。"""
    metrics = build("regression_metrics", max_scatter_points=50).run(
        {"scored": scored_frame(60)}
    )["metrics"]
    assert len(metrics.pairs) == 50
    assert metrics.is_truncated is True


def test_the_ridge_solution_matches_its_closed_form() -> None:
    """岭回归解的就是 (XᵀX + αI)β = Xᵀy，且截距不进惩罚项。"""
    rows = [[1.0, 2.0], [2.0, 1.0], [3.0, 4.0], [4.0, 3.0], [5.0, 7.0]]
    target = [3.0, 4.0, 8.0, 9.0, 14.0]
    alpha = 2.5
    estimator = LeastSquares(
        use_intercept=True, regularization="ridge", ridge_alpha=alpha
    )
    estimator.fit(rows, target)
    matrix = np.array(rows)
    centered = matrix - matrix.mean(axis=0)
    expected = np.linalg.solve(
        centered.T @ centered + alpha * np.eye(2),
        centered.T @ (np.array(target) - np.mean(target)),
    )
    assert estimator.coef == pytest.approx(list(expected), abs=1e-9)
    assert estimator.intercept == pytest.approx(
        float(np.mean(target) - matrix.mean(axis=0) @ expected), abs=1e-9
    )
