"""填缺失与离群裁剪的结果面：逐列的表、格子账、处理前的分布。

⚠ 这一组反复验的是**参数只在训练行上学**：拿整帧算出来的均值与界，每个数看着
都正常，而讲解里印出来的那份正是用户要拿去核对的。
⚠ 界在训练行上定、裁的却是整帧，所以「整帧的极值超出训练段」是一条免费的告警
（docs/MODELING_RESULT_VIEW_DESIGN.md §11 的 R-21）。
"""

from typing import Any

import pytest

from platform_server.apps.modeling.operators import (
    CellValue,
    Frame,
    FrameColumn,
    registry,
)
from platform_server.apps.modeling.operators.fitreport import (
    NO_BOUND_REASON,
    NO_FILL_REASON,
)
from platform_server.apps.modeling.operators.fitting import (
    PLAN_METHOD,
    PLAN_RANDOM_STATE,
    PLAN_TARGET,
    PLAN_TEST_RATIO,
)
from platform_server.apps.modeling.operators.reporting import ReportBlock
from platform_server.apps.modeling.services import report_budget
from platform_server.apps.modeling.services.preview import REPORT_MAX_BYTES

KEY = "温度"
OTHER = "负荷"
# 最坏负载：60 列宽帧 × 366 天逐时
WIDE_COLUMNS = 60
YEAR_ROWS = 366 * 24
# √2，总体口径标准差在 [1,2,3,4,5] 上的取值
ROOT_TWO = 2**0.5


def frame_of(columns: dict[str, list[float | None]]) -> Frame:
    """按列造一份数值帧，列序即给定的顺序。

    Args: columns。
    """
    keys = list(columns)
    height = len(columns[keys[0]])
    rows: tuple[tuple[CellValue, ...], ...] = tuple(
        tuple(columns[key][index] for key in keys) for index in range(height)
    )
    return Frame(
        columns=tuple(
            FrameColumn(key=key, name=key, dtype="number") for key in keys
        ),
        rows=rows,
    )


def half_split() -> dict[str, Any]:
    """按时序对半切的切分计划：前一半进训练集。"""
    return {
        PLAN_TARGET: OTHER,
        PLAN_METHOD: "time_order",
        PLAN_TEST_RATIO: 0.5,
        PLAN_RANDOM_STATE: 0,
    }


def blocks_of(
    code: str,
    frame: Frame,
    *,
    plan: dict[str, Any] | None = None,
    **config: Any,
) -> dict[str, ReportBlock]:
    """跑一遍算子并把讲解按块种类归好。

    Args: code, frame, plan, config。
    """
    operator, _ = registry.build(code, config)
    operator.bind_runtime(tz_offset_minutes=480, split_plan=plan)
    operator.run({"frame": frame})
    return {block.kind: block for block in operator.report()}


def params_of(blocks: dict[str, ReportBlock], key: str) -> dict[str, Any]:
    """逐列表里某一列那一行的参数。

    Args: blocks, key。
    """
    rows: list[dict[str, Any]] = blocks["fits"].payload["by_column"]
    return next(row["params"] for row in rows if row["key"] == key)


def reason_of(blocks: dict[str, ReportBlock], key: str) -> str:
    """逐列表里某一列那一行的跳过理由。

    Args: blocks, key。
    """
    rows: list[dict[str, Any]] = blocks["fits"].payload["by_column"]
    return next(row["skipped_reason"] for row in rows if row["key"] == key)


def cells_of(blocks: dict[str, ReportBlock]) -> list[dict[str, Any]]:
    """格子账里逐列的那几行。

    Args: blocks。
    """
    listed: list[dict[str, Any]] = blocks["cells"].payload["by_column"]
    return listed


def bins_of(blocks: dict[str, ReportBlock], key: str) -> dict[str, Any]:
    """分布图里某一列的那一份。

    Args: blocks, key。
    """
    listed: list[dict[str, Any]] = blocks["bins"].payload["by_column"]
    return next(column for column in listed if column["key"] == key)


def wide_frame(has_nulls: bool) -> Frame:
    """最坏负载：60 列 × 366 天逐时，取值跨度与空格分布逐列不同。

    Args: has_nulls。
    """
    return frame_of(
        {
            f"很长的列名字第{index}列": [
                (
                    None
                    if has_nulls and (row + index) % 4 == 0
                    else float((row % 97) * (index + 1)) + 0.123456789
                )
                for row in range(YEAR_ROWS)
            ]
            for index in range(WIDE_COLUMNS)
        }
    )


def test_a_fill_that_never_ran_says_nothing() -> None:
    """没跑过就一块都不讲——空壳会让界面摆出一片空白的分区。"""
    operator, _ = registry.build("fill_missing", {})
    assert operator.report() == ()


def test_the_fill_table_carries_the_value_and_the_holes_it_plugged() -> None:
    """四行里空一格：均值 4.0 填了 1 格，填前空值率 0.25，拟合样本 3 个。"""
    blocks = blocks_of(
        "fill_missing", frame_of({KEY: [2.0, 4.0, None, 6.0]}), strategy="mean"
    )
    params = params_of(blocks, KEY)
    assert params["fill"] == 4.0
    assert params["filled"] == 1
    assert params["null_ratio_before"] == 0.25
    assert params["fit_rows"] == 3


def test_the_fill_value_comes_from_the_training_rows_only() -> None:
    """训练段全是 10，整帧均值却是 6.57——印出来的必须是训练段那个数。"""
    values = [10.0, 10.0, 10.0, 10.0, 2.0, 2.0, 2.0, None]
    blocks = blocks_of(
        "fill_missing",
        frame_of({KEY: values, OTHER: [1.0] * 8}),
        plan=half_split(),
        strategy="mean",
        columns=[KEY],
    )
    params = params_of(blocks, KEY)
    assert params["fill"] == 10.0
    assert params["fit_rows"] == 4
    assert blocks["fits"].payload["train_rows"] == 4
    assert blocks["fits"].payload["total_rows"] == 8


def test_a_column_that_was_not_filled_keeps_its_row_and_says_why() -> None:
    """整列全空又配了放过：这一列照进表，填充值那一栏空着并写明原因。"""
    blocks = blocks_of(
        "fill_missing",
        frame_of({KEY: [None, None, None]}),
        strategy="mean",
        on_all_null="skip",
    )
    assert params_of(blocks, KEY)["fill"] is None
    assert params_of(blocks, KEY)["filled"] == 0
    assert params_of(blocks, KEY)["fit_rows"] == 0
    assert reason_of(blocks, KEY) == NO_FILL_REASON


def test_the_constant_strategy_reports_the_configured_value() -> None:
    """固定值填法印的是配的那个数，方法名也跟着走。"""
    blocks = blocks_of(
        "fill_missing",
        frame_of({KEY: [None, 1.0]}),
        strategy="constant",
        value=7.5,
    )
    assert blocks["fits"].payload["method"] == "constant"
    assert params_of(blocks, KEY)["fill"] == 7.5


def test_the_cell_count_lists_the_busiest_columns_and_skips_the_untouched() -> (
    None
):
    """一格没填的列不列：那一栏答的是「哪几列被动过」。"""
    blocks = blocks_of(
        "fill_missing",
        frame_of(
            {
                KEY: [None, None, None, 1.0],
                OTHER: [None, 1.0, 1.0, 1.0],
                "湿度": [1.0, 1.0, 1.0, 1.0],
            }
        ),
        strategy="mean",
    )
    assert [cell["key"] for cell in cells_of(blocks)] == [KEY, OTHER]
    assert [cell["changed"] for cell in cells_of(blocks)] == [3, 1]


def test_the_fill_value_is_drawn_as_a_line_on_the_distribution() -> None:
    """填充值那条线画在 10/3 上，两个空值不在这条轴上、单独一撮。"""
    blocks = blocks_of(
        "fill_missing",
        frame_of({KEY: [0.0, 0.0, 10.0, None, None]}),
        strategy="mean",
    )
    column = bins_of(blocks, KEY)
    assert column["marks"][0]["at"] == pytest.approx(10 / 3)
    assert column["marks"][0]["intent"] == "warning"
    assert column["low"] == 0.0
    assert column["high"] == 10.0
    assert column["off_axis"] == {"label": "空值", "count": 2}


def test_the_fill_distribution_covers_every_row_not_only_the_fitted_ones() -> (
    None
):
    """填的是整帧，所以图铺的也是整帧：只画训练段的话，轴会停在 10 上。"""
    values = [10.0, 10.0, 10.0, 10.0, 2.0, 2.0, 2.0, None]
    blocks = blocks_of(
        "fill_missing",
        frame_of({KEY: values, OTHER: [1.0] * 8}),
        plan=half_split(),
        strategy="mean",
        columns=[KEY],
    )
    column = bins_of(blocks, KEY)
    assert column["low"] == 2.0
    assert column["high"] == 10.0
    assert column["off_axis"] == {"label": "空值", "count": 1}


def test_the_worst_fill_load_still_fits_the_report_budget() -> None:
    """60 列宽帧 × 366 天逐时：讲解装得下，一块都不用降档丢掉。"""
    operator, _ = registry.build("fill_missing", {"strategy": "median"})
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    operator.run({"frame": wide_frame(has_nulls=True)})
    report = report_budget.fit_report(operator.report())
    assert report is not None
    assert report["dropped"] == []
    assert report_budget.size_of(report) < REPORT_MAX_BYTES


def test_a_clip_that_never_ran_says_nothing() -> None:
    """没跑过就一块都不讲——空壳会让界面摆出一片空白的分区。"""
    operator, _ = registry.build("clip_outlier", {})
    assert operator.report() == ()


def test_the_bound_table_shows_where_the_two_lines_came_from() -> None:
    """[1..5] 上 μ=3、σ=√2，一倍标准差把两端各夹回来一格。"""
    blocks = blocks_of(
        "clip_outlier",
        frame_of({KEY: [1.0, 2.0, 3.0, 4.0, 5.0]}),
        method="zscore",
        threshold=1.0,
    )
    params = params_of(blocks, KEY)
    assert params["k"] == 1.0
    assert params["mean"] == 3.0
    assert params["sd"] == pytest.approx(ROOT_TWO)
    assert params["q1"] is None
    assert params["low"] == pytest.approx(3.0 - ROOT_TWO)
    assert params["high"] == pytest.approx(3.0 + ROOT_TWO)
    assert params["clipped_low"] == 1
    assert params["clipped_high"] == 1
    assert params["untouched"] == 3
    assert params["fit_rows"] == 5


def test_the_quartile_method_reports_quartiles_and_not_a_mean() -> None:
    """[1..5] 上 Q1=2、Q3=4，一倍四分位距的界是 [0,6]，一格都没夹。"""
    blocks = blocks_of(
        "clip_outlier",
        frame_of({KEY: [1.0, 2.0, 3.0, 4.0, 5.0]}),
        method="iqr",
        threshold=1.0,
    )
    params = params_of(blocks, KEY)
    assert params["q1"] == 2.0
    assert params["q3"] == 4.0
    assert params["mean"] is None
    assert params["sd"] is None
    assert params["low"] == 0.0
    assert params["high"] == 6.0
    assert params["untouched"] == 5


def test_the_clipped_cells_carry_the_bounds_and_the_original_values() -> None:
    """夹掉的两格连原值一起交出去：用户照它核对「哦是那两行」。"""
    blocks = blocks_of(
        "clip_outlier",
        frame_of({KEY: [1.0, 2.0, 3.0, 4.0, 5.0]}),
        method="zscore",
        threshold=1.0,
    )
    cell = cells_of(blocks)[0]
    assert cell["changed"] == 2
    assert cell["low"] == pytest.approx(3.0 - ROOT_TWO)
    assert cell["high"] == pytest.approx(3.0 + ROOT_TWO)
    assert cell["samples"] == [1.0, 5.0]


def test_a_column_that_kept_every_row_is_not_listed_as_touched() -> None:
    """界宽到一格都没夹时，格子账里一列都没有。"""
    blocks = blocks_of(
        "clip_outlier",
        frame_of({KEY: [1.0, 2.0, 3.0, 4.0, 5.0]}),
        method="iqr",
        threshold=1.0,
    )
    assert cells_of(blocks) == []


def test_a_test_row_beyond_the_training_range_is_called_out() -> None:
    """训练段只在 [10,14] 上，整帧却从 0 铺到 100：测试段越出了训练分布。"""
    values = [10.0, 11.0, 12.0, 13.0, 14.0, 0.0, 7.0, 8.0, 9.0, 100.0]
    blocks = blocks_of(
        "clip_outlier",
        frame_of({KEY: values, OTHER: [1.0] * 10}),
        plan=half_split(),
        method="zscore",
        threshold=3.0,
        columns=[KEY],
    )
    params = params_of(blocks, KEY)
    assert params["mean"] == 12.0
    assert params["train_low"] == 10.0
    assert params["train_high"] == 14.0
    assert params["all_low"] == 0.0
    assert params["all_high"] == 100.0
    assert params["beyond_train"] is True


def test_a_test_segment_inside_the_training_range_is_not_called_out() -> None:
    """测试段整段落在训练段的跨度里，就没有这条告警。"""
    values = [0.0, 2.0, 4.0, 6.0, 8.0, 1.0, 2.0, 3.0, 4.0, 5.0]
    blocks = blocks_of(
        "clip_outlier",
        frame_of({KEY: values, OTHER: [1.0] * 10}),
        plan=half_split(),
        method="zscore",
        threshold=3.0,
        columns=[KEY],
    )
    assert params_of(blocks, KEY)["beyond_train"] is False


def test_without_a_split_the_beyond_training_verdict_is_unknown() -> None:
    """图里没有切分就没有训练段之外的行，答 False 是替用户下没根据的结论。"""
    blocks = blocks_of(
        "clip_outlier",
        frame_of({KEY: [1.0, 2.0, 3.0, 4.0, 100.0]}),
        method="zscore",
        threshold=3.0,
    )
    assert params_of(blocks, KEY)["beyond_train"] is None


def test_a_column_with_too_few_values_keeps_its_row_and_says_why() -> None:
    """两个取值定不出界：这一列照进表，上下界空着并写明原因。"""
    blocks = blocks_of(
        "clip_outlier",
        frame_of({KEY: [1.0, 2.0]}),
        method="zscore",
        threshold=1.0,
        on_no_bound="skip",
    )
    params = params_of(blocks, KEY)
    assert params["low"] is None
    assert params["high"] is None
    assert params["fit_rows"] == 2
    assert reason_of(blocks, KEY) == NO_BOUND_REASON


def test_the_two_bounds_are_drawn_as_danger_lines_on_the_raw_spread() -> None:
    """轴按裁剪前的实际跨度铺，两条界线画在它里面，空值单独一撮。"""
    blocks = blocks_of(
        "clip_outlier",
        frame_of({KEY: [1.0, 2.0, 3.0, 4.0, 5.0, None]}),
        method="iqr",
        threshold=1.0,
    )
    column = bins_of(blocks, KEY)
    assert column["low"] == 1.0
    assert column["high"] == 5.0
    assert [mark["at"] for mark in column["marks"]] == [0.0, 6.0]
    assert [mark["intent"] for mark in column["marks"]] == ["danger", "danger"]
    assert column["off_axis"] == {"label": "空值", "count": 1}


def test_the_clip_distribution_covers_the_rows_it_clipped() -> None:
    """裁的是整帧，所以图铺的也是整帧：只画训练段的话，越界的那一行看不见。"""
    values = [10.0, 11.0, 12.0, 13.0, 14.0, 0.0, 7.0, 8.0, 9.0, 100.0]
    blocks = blocks_of(
        "clip_outlier",
        frame_of({KEY: values, OTHER: [1.0] * 10}),
        plan=half_split(),
        method="zscore",
        threshold=3.0,
        columns=[KEY],
    )
    column = bins_of(blocks, KEY)
    assert column["low"] == 0.0
    assert column["high"] == 100.0


def test_the_worst_clip_load_still_fits_the_report_budget() -> None:
    """60 列宽帧 × 366 天逐时：讲解装得下，一块都不用降档丢掉。"""
    operator, _ = registry.build(
        "clip_outlier", {"method": "iqr", "threshold": 1.5}
    )
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    operator.run({"frame": wide_frame(has_nulls=False)})
    report = report_budget.fit_report(operator.report())
    assert report is not None
    assert report["dropped"] == []
    assert report_budget.size_of(report) < REPORT_MAX_BYTES


def test_the_worst_clip_load_keeps_the_tables_within_their_caps() -> None:
    """60 列全进定界表、只有 8 列进分布图、格子账最多 12 列。"""
    blocks = blocks_of(
        "clip_outlier",
        wide_frame(has_nulls=False),
        method="zscore",
        threshold=0.5,
    )
    assert len(blocks["fits"].payload["by_column"]) == WIDE_COLUMNS
    assert len(blocks["bins"].payload["by_column"]) == 8
    assert len(cells_of(blocks)) == 12
