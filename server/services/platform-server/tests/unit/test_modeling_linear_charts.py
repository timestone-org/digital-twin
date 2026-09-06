"""线性回归 ③ 区那三张图：残差对预测、真值对预测、每一列的系数。

⚠ 这一组反复验的是「点摆的是不是那两个量」：残差图与真值图的横轴同一个数，
只有纵轴不同，两者写反了图还是画得出来、字节也一样多，只有逐点核对才认得出来
（docs/MODELING_RESULT_VIEW_DESIGN.md §5-17）。
"""

from collections.abc import Sequence
from dataclasses import replace
from typing import Any

import pytest

from platform_server.apps.modeling.operators.frame import Frame, matrix_of
from platform_server.apps.modeling.operators.linearreport import (
    Trained,
    linear_blocks,
)
from platform_server.apps.modeling.operators.reporting import (
    MAX_CLOUD_POINTS,
    ReportBlock,
)
from platform_server.apps.modeling.services import report_budget
from platform_server.apps.modeling.services.preview import REPORT_MAX_BYTES
from unit.modeling_fakes import hints_of
from unit.test_modeling_linear_report import (
    LOAD,
    TARGET,
    WARM,
    WIDE_COLUMNS,
    YEAR_ROWS,
    blocks_of,
    frame_of,
    linear_columns,
    warm_of,
    wide_columns,
)

# 造数用的行数：切三成之后测试段刚好过 200 行，抽样那条路才走得到
LONG_ROWS = 800
LONG_TEST_ROWS = 240
# 测试段整体抬高这么多：残差与真值因此绝不相等，两张图写反了当场分得出来
LIFT = 40.0
# 短夹具：40 行按三成切，测试段 12 行
SHORT_ROWS = 40
SHORT_TEST_ROWS = 12


def charts_of(blocks: Sequence[ReportBlock]) -> list[ReportBlock]:
    """③ 区那几块，按摆出来的先后。

    Args: blocks。
    """
    return [block for block in blocks if block.zone == "charts"]


def cloud_of(blocks: Sequence[ReportBlock], title: str) -> dict[str, Any]:
    """某一张散点图那一包。

    Args: blocks, title。
    """
    block = next(one for one in blocks if one.title == title)
    clouds: Any = block.payload["clouds"]
    return clouds[0]


def trained_of(train: Frame, test: Frame) -> Trained:
    """手拼一次「已经拟合过」的样子。

    ⚠ 走这条路而不是跑算子：打分那一步在真值有空值时直接抛（`model.py` 的
    `scored_frame`），而块要在那道闸松掉之后仍然不许把空值补成 0。
    Args: train, test。
    """
    coef = {WARM: 2.0, LOAD: 3.0}
    rows = matrix_of(test, (WARM, LOAD))
    return Trained(
        train=train,
        test=test,
        keys=(WARM, LOAD),
        target=TARGET,
        predicted=[
            5.0 + coef[WARM] * row[0] + coef[LOAD] * row[1] for row in rows
        ],
        coef=coef,
        intercept=5.0,
        use_intercept=True,
        method="none",
    )


def lifted_columns(rows: int) -> dict[str, list[float]]:
    """严格线性的三列，靠后那一段整体抬高——测试段因此有一整片正残差。

    Args: rows。
    """
    columns = linear_columns(rows)
    train_rows = rows - round(rows * 0.3)
    columns[TARGET] = [
        value + (0.0 if seat < train_rows else LIFT)
        for seat, value in enumerate(columns[TARGET])
    ]
    return columns


def test_the_least_squares_report_draws_three_pictures() -> None:
    """③ 区摆三张，两张散点标主体图、系数条标辅图。

    ⚠ 两张散点都标主体：辅图那一格只有半幅宽，而两轴刻度随画幅等比缩，摆进去
    刻度字会掉到 10px 上（规格 §3.2 的辅图网格）。
    """
    charts = charts_of(
        blocks_of("linear_regression", frame_of(lifted_columns(SHORT_ROWS)))
    )

    assert [block.title for block in charts] == [
        "残差对预测值",
        "真值对预测值",
        "每一列的系数",
    ]
    assert [block.payload["is_primary"] for block in charts] == [
        True,
        True,
        False,
    ]


def test_the_residual_picture_plots_the_residual_not_the_truth() -> None:
    """残差图的纵轴是真值减预测值。

    ⚠ 这里的夹具特意让测试段整体抬高：真值与残差因此差着 40，写成真值当场红。
    """
    blocks = blocks_of(
        "linear_regression", frame_of(lifted_columns(SHORT_ROWS))
    )
    cloud = cloud_of(blocks, "残差对预测值")
    truth = cloud_of(blocks, "真值对预测值")
    points: Any = cloud["points"]

    assert cloud["mode"] == "residual"
    assert [point[0] for point in points] == [
        point[0] for point in truth["points"]
    ]
    for point, other in zip(points, truth["points"], strict=True):
        assert point[1] == pytest.approx(other[1] - other[0], abs=1e-3)
    assert all(point[1] == pytest.approx(LIFT, abs=1e-3) for point in points)


def test_the_truth_picture_plots_the_truth_against_the_prediction() -> None:
    """真值图的两个坐标就是预测值与真值，画法是两轴同尺的 pairs。"""
    cloud = cloud_of(
        blocks_of("linear_regression", frame_of(lifted_columns(SHORT_ROWS))),
        "真值对预测值",
    )
    points: Any = cloud["points"]

    assert cloud["mode"] == "pairs"
    for point in points:
        assert point[1] == pytest.approx(point[0] + LIFT, abs=1e-3)


def test_the_pictures_name_their_axes_with_the_target_unit() -> None:
    """两根轴都带目标列的单位：没有单位的「预测值」读不出量级。"""
    blocks = blocks_of(
        "linear_regression", frame_of(lifted_columns(SHORT_ROWS))
    )
    residual = cloud_of(blocks, "残差对预测值")
    truth = cloud_of(blocks, "真值对预测值")

    assert residual["x_label"] == "预测值（千瓦时）"
    assert residual["y_label"] == "残差（千瓦时）"
    assert truth["y_label"] == "真值（千瓦时）"


def test_the_pictures_sample_evenly_instead_of_taking_the_head() -> None:
    """点多了等距抽，不是头切。

    ⚠ 头切在时序数据上等于只画测试段最早的那一截，而这两张图要答的是「整段
    测试集上准不准」。夹具里真值随行号一路走高，头切的话最后一个点会停在
    半路上。
    """
    columns = linear_columns(LONG_ROWS)
    columns[TARGET] = [float(seat) for seat in range(LONG_ROWS)]
    blocks = blocks_of("linear_regression", frame_of(columns))
    points: Any = cloud_of(blocks, "真值对预测值")["points"]

    assert len(points) == MAX_CLOUD_POINTS
    assert points[0][1] == pytest.approx(float(LONG_ROWS - LONG_TEST_ROWS))
    assert points[-1][1] == pytest.approx(float(LONG_ROWS - 1))


def test_the_pictures_leave_out_the_rows_whose_truth_is_missing() -> None:
    """真值是空的那一行整行不进图。

    ⚠ 补 0 顶上去的话，那一行会在零附近落一个点，而残差正好等于负的预测值——
    图上看着完全正常，读起来却是「有一行错到离谱」（规格 §2-P4）。
    """
    columns = lifted_columns(SHORT_ROWS)
    truth: list[float | None] = list(columns[TARGET])
    truth[SHORT_ROWS - 1] = None
    train = frame_of(columns)
    filled = linear_blocks(trained_of(train, train))
    holed = linear_blocks(
        trained_of(train, frame_of({**columns, TARGET: truth}))
    )

    assert len(cloud_of(filled, "真值对预测值")["points"]) == SHORT_ROWS
    assert len(cloud_of(holed, "真值对预测值")["points"]) == SHORT_ROWS - 1


def test_the_weight_picture_keeps_the_sign_of_every_coefficient() -> None:
    """系数条一列一根，负的照原样留着负号——零线居中就靠它。"""
    columns = linear_columns()
    columns[TARGET] = [
        2.0 * one - 3.0 * other
        for one, other in zip(columns[WARM], columns[LOAD], strict=True)
    ]
    blocks = blocks_of("linear_regression", frame_of(columns))
    items: Any = next(
        one for one in blocks if one.title == "每一列的系数"
    ).payload["items"]

    assert [item["name"] for item in items] == [WARM, LOAD]
    assert items[0]["value"] == pytest.approx(2.0)
    assert items[1]["value"] == pytest.approx(-3.0)


def test_the_weight_picture_says_when_the_bars_are_not_comparable() -> None:
    """各列量纲差过十倍才提醒「条长不是重要性」，差得不多时不啰嗦。"""
    wide = blocks_of("linear_regression", frame_of(linear_columns()))
    even = linear_columns()
    even[LOAD] = [warm_of(seat) + 1.0 for seat in range(len(even[WARM]))]
    even[TARGET] = [
        2.0 * one + 3.0 * other
        for one, other in zip(even[WARM], even[LOAD], strict=True)
    ]
    narrow = blocks_of("linear_regression", frame_of(even))

    assert [
        note
        for note in hints_of(
            next(one for one in wide if one.title == "每一列的系数")
        )
        if "不是重要性" in note
    ]
    assert not [
        note
        for note in hints_of(
            next(one for one in narrow if one.title == "每一列的系数")
        )
        if "不是重要性" in note
    ]


def test_the_worst_chart_load_still_fits_the_report_budget() -> None:
    """60 列宽帧 × 366 天逐时：三张图连同别的块一起装得下，一块都不丢。

    ⚠ 断言的是**整串**块：按区归成字典的话，③ 区三块只剩最后那一块进账，图
    越大它越量不到。
    """
    blocks = blocks_of("linear_regression", frame_of(wide_columns(YEAR_ROWS)))
    report = report_budget.fit_report(blocks)

    assert report is not None
    assert report["dropped"] == []
    assert report_budget.size_of(report) < REPORT_MAX_BYTES
    assert len(charts_of(blocks)) == 3
    assert len(cloud_of(blocks, "残差对预测值")["points"]) == MAX_CLOUD_POINTS
    assert (
        len(
            next(one for one in blocks if one.title == "每一列的系数").payload[
                "items"
            ]
        )
        == WIDE_COLUMNS - 1
    )


def test_a_prediction_list_out_of_step_with_the_frame_draws_nothing() -> None:
    """预测值与测试帧对不上号时一张散点都不画。

    ⚠ 不许按短的那一边截着画：两串错位之后每个点都落在别人的横坐标上，而图看
    着完全正常——那比没有这张图坏得多（规格 §2-P4）。
    """
    columns = lifted_columns(SHORT_ROWS)
    train = frame_of(columns)
    seen = trained_of(train, train)
    blocks = linear_blocks(replace(seen, predicted=seen.predicted[:-1]))

    assert [block.title for block in charts_of(blocks)] == ["每一列的系数"]


def test_a_run_with_no_usable_rows_draws_no_scatter_at_all() -> None:
    """测试段一行真值都没有时不摆空图，系数条照旧。"""
    columns = lifted_columns(SHORT_ROWS)
    blank: list[float | None] = [None] * SHORT_ROWS
    blocks = linear_blocks(
        trained_of(frame_of(columns), frame_of({**columns, TARGET: blank}))
    )

    assert [block.title for block in charts_of(blocks)] == ["每一列的系数"]
