"""规格 §10.2 契约 #2：24 个算子跑完都真的讲得出东西。

从**算子花名册**反向遍历，逐个造一份最小可跑输入、真跑一遍 `report()`。
⚠ 只断言 `hasattr(cls, "report")` 是恒真的：基类给了「一块都不讲」的默认实现，
任何一个算子把 `report()` 退回空元组都不会红，而失败形态是那一步的结果面永远
只剩一副裸骨架，全闸却是绿的（docs/MODELING_RESULT_VIEW_DESIGN.md §10.2）。
"""

from typing import Any

import pytest

from platform_server.apps.modeling.operators import (
    BLOCK_KINDS,
    ZONES,
    Frame,
    FrameColumn,
    OperatorBase,
    ReportBlock,
    registry,
)
from platform_server.apps.modeling.operators.base import PREFETCHED_KEY
from platform_server.apps.modeling.operators.frame import (
    DTYPE_NUMBER,
    DTYPE_STRING,
    ROLE_FEATURE,
    ROLE_TARGET,
    with_roles,
)
from platform_server.apps.modeling.operators.payloads import ModelPayload
from platform_server.apps.modeling.services import report_budget
from platform_server.apps.modeling.services.preview import REPORT_MAX_BYTES

HOUR_MS = 3_600_000
ROWS = 48
TARGET = "能耗"
WARM = "温度"
LOAD = "负荷"
SHIFT = "班次"
# 目标列的真实关系：能耗 = 2×温度 + 3×负荷 + 5
SLOPE_WARM = 2.0
SLOPE_LOAD = 3.0
INTERCEPT = 5.0
# 分类那一路的判据：温度过了这条线算超标
HOT = 24.0
# 造不出最小输入、只好放过的算子。⚠ 这份名单必须一直是空的：往里加一个名字
# 等于把那个算子的结果面移出这道闸
UNREACHABLE: tuple[str, ...] = ()

#: 一份最小可跑输入 = `(端口负载, 算子参数)`
type Case = tuple[dict[str, Any], dict[str, Any]]


def number(key: str, role: str = ROLE_FEATURE) -> FrameColumn:
    """一列数值列。

    Args: key, role。
    """
    return FrameColumn(key=key, name=key, dtype=DTYPE_NUMBER, role=role)


def frame() -> Frame:
    """三列数值 + 一列文本 + 一列目标，带逐时时刻。

    ⚠ 文本列与时刻两样都得有：独热与时间特征少了它们当场抛，而抛出来的那一步
    一块都不讲——那正是这道闸要分辨的两种情形之一。
    """
    return Frame(
        columns=(
            number(WARM),
            number(LOAD),
            FrameColumn(key=SHIFT, name=SHIFT, dtype=DTYPE_STRING),
            number(TARGET, ROLE_TARGET),
        ),
        rows=tuple(
            (
                20.0 + (seat % 13) * 0.7,
                400.0 + (seat % 7) * 15.0,
                "甲" if seat % 2 else "乙",
                SLOPE_WARM * (20.0 + (seat % 13) * 0.7)
                + SLOPE_LOAD * (400.0 + (seat % 7) * 15.0)
                + INTERCEPT,
            )
            for seat in range(ROWS)
        ),
        index=tuple(seat * HOUR_MS for seat in range(ROWS)),
    )


def labelled() -> Frame:
    """目标列是 0/1 的那一份，逻辑回归拿它训。"""
    return Frame(
        columns=(number(WARM), number(LOAD), number("是否超标", ROLE_TARGET)),
        rows=tuple(
            (
                20.0 + (seat % 13) * 0.7,
                400.0 + (seat % 7) * 15.0,
                1.0 if 20.0 + (seat % 13) * 0.7 > HOT else 0.0,
            )
            for seat in range(ROWS)
        ),
        index=tuple(seat * HOUR_MS for seat in range(ROWS)),
    )


def scored(*, is_binary: bool = False) -> Frame:
    """一份打分帧：真实值一列、预测值一列，带时刻。

    Args: is_binary（真实值与预测值取 0/1）。
    """
    rows = (
        tuple((float(seat % 2), float((seat // 3) % 2)) for seat in range(40))
        if is_binary
        else tuple((float(seat + 1), float(seat) + 0.5) for seat in range(40))
    )
    return Frame(
        columns=(
            FrameColumn(key="y_true", name="真实值", dtype=DTYPE_NUMBER),
            FrameColumn(key="y_pred", name="预测值", dtype=DTYPE_NUMBER),
        ),
        rows=rows,
        index=tuple(seat * HOUR_MS for seat in range(len(rows))),
    )


def model_of(trained: Frame) -> ModelPayload:
    """在给定帧上训一个线性回归，回它的模型描述。

    Args: trained。
    """
    operator, _ = registry.build("linear_regression", {})
    operator.bind_runtime(tz_offset_minutes=0, split_plan=None)
    payload = operator.run({"train": trained, "test": trained})["model"]
    assert isinstance(payload, ModelPayload)
    return payload


def frame_cases(source: Frame) -> dict[str, Case]:
    """吃一路帧、吐一路帧的那些算子各自的最小输入。

    Args: source。
    """
    one: dict[str, Any] = {"frame": source}
    return {
        "cast_type": (one, {"columns": [SHIFT], "to": "number"}),
        "clip_outlier": (one, {}),
        "drop_missing": (one, {}),
        "fill_missing": (one, {}),
        "filter_rows": (one, {"column": WARM, "op": "gte", "value": 0.0}),
        "lag_feature": (one, {"columns": [WARM], "lags": [1]}),
        "one_hot": (one, {"columns": [SHIFT]}),
        "pca": (one, {"n_components": 2}),
        "resample": (one, {}),
        "rolling_feature": (one, {"columns": [WARM], "window": 3}),
        "select_feature": (
            {"frame": with_roles(source, target_key=TARGET)},
            {},
        ),
        "split_dataset": (one, {"target_column": TARGET}),
        "standardize": (one, {}),
        "time_feature": (one, {}),
    }


def other_cases(source: Frame) -> dict[str, Case]:
    """取数、对齐、建模与评估那些算子各自的最小输入。

    Args: source。
    """
    roled = with_roles(source, target_key=TARGET)
    pair: dict[str, Any] = {"train": roled, "test": roled}
    trained = model_of(roled)
    binary: dict[str, Any] = {"train": labelled(), "test": labelled()}
    return {
        "classification_metrics": ({"scored": scored(is_binary=True)}, {}),
        "cross_validate": ({"model": trained, "frame": roled}, {"folds": 4}),
        "feature_importance": ({"model": trained, "test": roled}, {}),
        "ledger_join": ({"left": source, "right": source}, {}),
        "ledger_source": (
            {PREFETCHED_KEY: source},
            {"table_code": "energy_h"},
        ),
        "linear_regression": (pair, {}),
        "logistic_regression": (binary, {}),
        "regression_metrics": ({"scored": scored()}, {}),
        "residual_analysis": ({"scored": scored()}, {}),
        "tree_regressor": (pair, {}),
    }


def cases() -> dict[str, Case]:
    """全部算子的最小输入表。"""
    source = frame()
    return {**frame_cases(source), **other_cases(source)}


def ran(code: str) -> OperatorBase:
    """按最小输入跑一遍这个算子，回它自己（`report()` 要问它）。

    Args: code。
    """
    inputs, config = cases()[code]
    operator, _ = registry.build(code, config)
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    operator.run(dict(inputs))
    return operator


def blocks_of(code: str) -> tuple[ReportBlock, ...]:
    """这个算子在最小输入上讲出来的那几块。

    Args: code。
    """
    return ran(code).report()


CODES = registry.codes()


def test_every_registered_operator_has_a_minimal_input_here() -> None:
    """反向遍历的入口：花名册上多一个算子，这张表就得跟着多一行。"""
    assert set(cases()) == set(CODES) - set(UNREACHABLE)
    assert UNREACHABLE == ()
    assert len(CODES) == 24


@pytest.mark.parametrize("code", CODES)
def test_every_operator_says_something_about_the_step_it_just_ran(
    code: str,
) -> None:
    """每个算子都至少讲一块第一区的话。

    ⚠ 只查 `hasattr` 的话这条恒绿：基类的缺省实现就是空元组，某个算子的
    `report()` 退回空之后，它的结果面只剩裸骨架而全闸不响。
    """
    blocks = blocks_of(code)
    assert [block.title for block in blocks if block.zone == "step"] != []


@pytest.mark.parametrize("code", CODES)
def test_every_block_lands_in_a_kind_and_a_zone_the_front_end_knows(
    code: str,
) -> None:
    """块的种类与区都在花名册里——写错一个字母前端就派发到未知块上。"""
    for block in blocks_of(code):
        assert block.kind in BLOCK_KINDS
        assert block.zone in ZONES


@pytest.mark.parametrize("code", CODES)
def test_every_report_fits_the_single_node_budget_without_dropping_a_block(
    code: str,
) -> None:
    """最小输入上一块都不该被降档丢掉，整份讲解也远在单节点上限之内。"""
    report = report_budget.fit_report(blocks_of(code))
    assert report is not None
    assert report["dropped"] == []
    assert report_budget.size_of(report) < REPORT_MAX_BYTES


@pytest.mark.parametrize("code", CODES)
def test_every_chart_says_whether_it_is_the_main_picture(code: str) -> None:
    """图区的每一块都显式标了主次。

    ⚠ 降档梯子第 2 档只丢辅图（规格 §4.6）：漏标的那一块按「主体图」留到最后，
    于是同一档梯子在不同算子上行为不同，而漏标在运行期一声不吭。
    """
    for block in blocks_of(code):
        if block.zone != "charts":
            continue
        assert isinstance(block.payload.get("is_primary"), bool)


@pytest.mark.parametrize("code", CODES)
def test_a_step_that_never_ran_keeps_its_mouth_shut(code: str) -> None:
    """没跑过就一块都不讲：空壳会让界面摆出一片空白的分区。"""
    operator, _ = registry.build(code, cases()[code][1])
    assert operator.report() == ()
