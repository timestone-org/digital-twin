"""特征筛选的结果面：打分排行、保留与淘汰、以及静默退化那条告警。

⚠ 这一份反复验的是退化的**方向**：真条件是下游切分的个数不是恰好一个，沿上游
判会在没退化时乱报、在真退化时抓不到（docs/MODELING_RESULT_VIEW_DESIGN.md §11
的 R-12）。
"""

from typing import Any

import pytest

from platform_server.apps.modeling.operators import (
    CellValue,
    Frame,
    FrameColumn,
    registry,
)
from platform_server.apps.modeling.operators.featureblocks import (
    DEGRADED_REASON,
    VARIANCE_HINT,
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

OTHER = "负荷"
# 最坏负载：60 列宽帧 × 366 天逐时
WIDE_COLUMNS = 60
YEAR_ROWS = 366 * 24


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


def run_of(
    frame: Frame,
    *,
    plan: dict[str, Any] | None = None,
    **config: Any,
) -> tuple[Frame, dict[str, ReportBlock]]:
    """跑一遍特征筛选，回它的输出帧与按种类归好的讲解。

    Args: frame, plan, config。
    """
    operator, _ = registry.build("select_feature", config)
    operator.bind_runtime(tz_offset_minutes=480, split_plan=plan)
    produced = operator.run({"frame": frame})["frame"]
    assert isinstance(produced, Frame)
    return produced, {block.kind: block for block in operator.report()}


def blocks_of(
    frame: Frame, *, plan: dict[str, Any] | None = None, **config: Any
) -> dict[str, ReportBlock]:
    """只要讲解那一半。

    Args: frame, plan, config。
    """
    return run_of(frame, plan=plan, **config)[1]


def items_of(blocks: dict[str, ReportBlock]) -> list[dict[str, Any]]:
    """打分排行里的每一条。

    Args: blocks。
    """
    listed: list[dict[str, Any]] = blocks["breakdown"].payload["items"]
    return listed


def item_of(blocks: dict[str, ReportBlock], name: str) -> dict[str, Any]:
    """打分排行里叫这个名字的那一条。

    Args: blocks, name。
    """
    return next(item for item in items_of(blocks) if item["name"] == name)


def wide_numbers() -> Frame:
    """最坏负载：60 列 × 366 天逐时，逐列跨度与空格分布各不相同。"""
    return frame_of(
        {
            f"很长的列名字第{index}列": [
                (
                    None
                    if (row + index) % 41 == 0
                    else float((row % 97) * (index + 1)) + 0.123456789
                )
                for row in range(YEAR_ROWS)
            ]
            for index in range(WIDE_COLUMNS)
        }
    )


def test_a_select_feature_that_never_ran_says_nothing() -> None:
    """没跑过就一块都不讲。"""
    operator, _ = registry.build("select_feature", {})
    assert operator.report() == ()


def test_the_ranking_scores_every_candidate_and_marks_the_cut() -> None:
    """方差 125 / 1.25 / 0.1875 三列留前两名，基准线画在留下的最低分上。"""
    frame = frame_of(
        {
            "甲": [1.0, 2.0, 3.0, 4.0],
            "乙": [0.0, 0.0, 0.0, 1.0],
            "丙": [10.0, 20.0, 30.0, 40.0],
        }
    )
    blocks = blocks_of(frame, top_k=2)
    assert [item["name"] for item in items_of(blocks)] == ["丙", "甲", "乙"]
    assert [item["value"] for item in items_of(blocks)] == pytest.approx(
        [125.0, 1.25, 0.1875]
    )
    assert [item["kept"] for item in items_of(blocks)] == [True, True, False]
    assert [item["rank"] for item in items_of(blocks)] == [1, 2, 3]
    assert blocks["breakdown"].payload["baseline"] == pytest.approx(1.25)
    assert blocks["breakdown"].payload["label"] == "方差"


def test_the_columns_block_lists_the_ones_that_lost() -> None:
    """淘汰名单与输出帧上真正少掉的那几列一致。"""
    frame = frame_of(
        {
            "甲": [1.0, 2.0, 3.0, 4.0],
            "乙": [0.0, 0.0, 0.0, 1.0],
            "丙": [10.0, 20.0, 30.0, 40.0],
        }
    )
    produced, blocks = run_of(frame, top_k=2)
    change = blocks["columns"].payload
    assert change["removed"] == ["乙"]
    assert change["kept"] == 2
    assert list(produced.keys) == ["甲", "丙"]
    assert change["reason"] == (
        "在 4 行训练行上按方差给 3 个候选列打分，留下前 2 列"
    )


def test_the_degradation_flag_is_on_when_no_split_plan_arrived() -> None:
    """下游切分不是恰好一个：这一步在整帧上排名，讲解必须自己说出来。"""
    frame = frame_of({"甲": [1.0, 2.0, 3.0, 4.0], "乙": [0.0, 0.0, 0.0, 1.0]})
    blocks = blocks_of(frame, top_k=1)
    assert blocks["columns"].payload["degraded"] is True
    assert blocks["columns"].payload["degraded_reason"] == DEGRADED_REASON
    assert "在 4 行训练行上" in blocks["columns"].payload["reason"]


def test_the_degradation_flag_is_off_when_one_split_sits_downstream() -> None:
    """恰好一个下游切分时排名只看训练行，那时报退化就是乱报。"""
    frame = frame_of(
        {
            "甲": [1.0, 2.0, 3.0, 4.0],
            "乙": [0.0, 0.0, 0.0, 1.0],
            OTHER: [1.0, 2.0, 3.0, 4.0],
        }
    )
    blocks = blocks_of(
        frame,
        plan=half_split(),
        top_k=1,
        columns=["甲", "乙"],
    )
    assert blocks["columns"].payload["degraded"] is False
    assert blocks["columns"].payload["degraded_reason"] == ""
    assert "在 2 行训练行上" in blocks["columns"].payload["reason"]


def test_the_ranking_only_looks_at_the_training_rows() -> None:
    """整帧上乙的方差更大，训练段上甲更大——留下来的必须是甲。"""
    frame = frame_of(
        {
            "甲": [0.0, 10.0, 0.0, 10.0, 5.0, 5.0, 5.0, 5.0],
            "乙": [1.0, 1.0, 1.0, 1.0, 0.0, 90.0, 0.0, 90.0],
            OTHER: [1.0] * 8,
        }
    )
    blocks = blocks_of(
        frame,
        plan=half_split(),
        top_k=1,
        columns=["甲", "乙"],
    )
    assert item_of(blocks, "甲")["value"] == pytest.approx(25.0)
    assert item_of(blocks, "乙")["value"] == pytest.approx(0.0)
    assert blocks["columns"].payload["removed"] == ["乙"]


def test_the_variance_hint_is_a_hint_and_only_on_that_method() -> None:
    """量纲提示只跟着方差档走；相关性档一个字都不说。"""
    frame = frame_of(
        {
            "甲": [1.0, 2.0, 3.0, 4.0],
            "乙": [4.0, 3.0, 2.0, 1.0],
            OTHER: [1.0, 2.0, 3.0, 4.0],
        }
    )
    by_variance = blocks_of(frame, top_k=1)
    assert by_variance["columns"].payload["notes"] == [VARIANCE_HINT]
    by_correlation = blocks_of(
        frame,
        plan=half_split(),
        method="correlation",
        top_k=1,
        columns=["甲", "乙"],
    )
    assert "notes" not in by_correlation["columns"].payload


def test_the_correlation_score_is_the_absolute_value() -> None:
    """反着走的那一列相关性是 −1，排行上必须按 1 排，不然它会垫底。"""
    frame = frame_of(
        {
            "甲": [4.0, 3.0, 2.0, 1.0, 8.0, 7.0, 6.0, 5.0],
            "乙": [1.0, 1.0, 2.0, 2.0, 3.0, 3.0, 4.0, 4.0],
            OTHER: [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0],
        }
    )
    blocks = blocks_of(
        frame,
        plan=half_split(),
        method="correlation",
        top_k=1,
        columns=["甲", "乙"],
    )
    assert item_of(blocks, "甲")["value"] == pytest.approx(1.0)
    assert blocks["breakdown"].payload["label"] == "与目标列相关性的绝对值"
    assert blocks["columns"].payload["removed"] == ["乙"]


def test_the_worst_select_load_still_fits_the_report_budget() -> None:
    """60 列宽帧 × 366 天逐时：讲解装得下，一块都不用降档丢掉。"""
    operator, _ = registry.build("select_feature", {"top_k": 5})
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    operator.run({"frame": wide_numbers()})
    report = report_budget.fit_report(operator.report())
    assert report is not None
    assert report["dropped"] == []
    assert report_budget.size_of(report) < REPORT_MAX_BYTES
    assert len(report["blocks"]) == 2
