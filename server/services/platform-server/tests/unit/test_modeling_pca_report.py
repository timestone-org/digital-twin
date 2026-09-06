"""主成分的结果面：碎石图与载荷、逐条轴的线性组合、以及两侧标签的对齐。

⚠ 这一份反复验的是**标签与矩阵切在同一处**：矩阵按上限截了而标签没截的话，
热力图上每一行都对着错的那条轴，而图看着完全正常
（docs/MODELING_RESULT_VIEW_DESIGN.md §5-12）。
"""

from typing import Any

import pytest

from platform_server.apps.modeling.operators import (
    CellValue,
    Frame,
    FrameColumn,
    registry,
)
from platform_server.apps.modeling.operators.pcablocks import (
    BLANK_NOTE,
    MAX_TERMS,
    OPAQUE_NOTE,
    PcaRun,
    pca_blocks,
)
from platform_server.apps.modeling.operators.reporting import (
    MAX_LOADING_WIDTH,
    MAX_LOADINGS,
    ReportBlock,
)
from platform_server.apps.modeling.services import report_budget
from platform_server.apps.modeling.services.preview import REPORT_MAX_BYTES
from unit.modeling_fakes import hints_of

# 最坏负载：60 列宽帧 × 366 天逐时
WIDE_COLUMNS = 60
YEAR_ROWS = 366 * 24


def frame_of(columns: dict[str, list[float]]) -> Frame:
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


def blocks_of(frame: Frame, **config: Any) -> dict[str, ReportBlock]:
    """跑一遍主成分，回按种类归好的讲解。

    Args: frame, config。
    """
    operator, _ = registry.build("pca", config)
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    operator.run({"frame": frame})
    return {block.kind: block for block in operator.report()}


def axis_row(blocks: dict[str, ReportBlock], key: str) -> dict[str, Any]:
    """公式表里那一条轴的行。

    Args: blocks, key。
    """
    listed: list[dict[str, Any]] = blocks["fits"].payload["by_column"]
    return next(item for item in listed if item["key"] == key)


def one_direction() -> Frame:
    """全部方差都在一条方向上：乙 = 2×甲，丙 是常数列。"""
    return frame_of(
        {
            "甲": [1.0, 2.0, 3.0, 4.0],
            "乙": [2.0, 4.0, 6.0, 8.0],
            "丙": [5.0, 5.0, 5.0, 5.0],
        }
    )


def wide_numbers(columns: int, rows: int) -> Frame:
    """一份没有空格的宽帧——主成分对空值零容忍。

    Args: columns, rows。
    """
    return frame_of(
        {
            f"很长的列名字第{index}列": [
                float((row % 97) * (index + 1)) + 0.123456789
                for row in range(rows)
            ]
            for index in range(columns)
        }
    )


def test_a_pca_that_never_ran_says_nothing() -> None:
    """没跑过就一块都不讲。"""
    operator, _ = registry.build("pca", {})
    assert operator.report() == ()


def test_the_scree_numbers_come_from_the_fit_not_from_a_guess() -> None:
    """方差全在一条方向上：pc1 解释掉 100%，pc2 解释掉 0。

    ⚠ 这两个数只有拟合那一刻拿得到：不把它们交出来的话，前端只能拿载荷去凑一个
    近似值，而近似值与「解释掉多少方差」不是同一个量。
    """
    blocks = blocks_of(one_direction(), n_components=2)
    explained = blocks["structure"].payload["explained"]
    assert explained == pytest.approx([1.0, 0.0], abs=1e-9)
    assert blocks["structure"].payload["cumulative"] == pytest.approx(
        [1.0, 1.0], abs=1e-9
    )


def test_the_loadings_say_which_columns_carry_the_axis() -> None:
    """乙 的权重是 甲 的两倍、丙 一点都不占——载荷就是这三个数。"""
    blocks = blocks_of(one_direction(), n_components=2)
    loadings: list[list[float]] = blocks["structure"].payload["loadings"]
    assert len(loadings) == 2
    assert [abs(weight) for weight in loadings[0]] == pytest.approx(
        [0.4472136, 0.8944272, 0.0], abs=1e-5
    )
    assert blocks["structure"].payload["loading_rows"] == ["pc1", "pc2"]
    assert blocks["structure"].payload["loading_columns"] == ["甲", "乙", "丙"]
    assert blocks["structure"].payload["is_loadings_cut"] is False


def test_the_formula_carries_the_centre_of_every_term() -> None:
    """代入式里减掉的那个数是这一列的中心点：甲 是 2.5、乙 是 5。

    ⚠ 少了中心点的公式是 `0.45×甲`，而真正算的是 `0.45×(甲−2.5)`，两者差着
    一个常数，用户照它算一遍对不上。
    """
    blocks = blocks_of(one_direction(), n_components=2)
    terms: list[dict[str, Any]] = axis_row(blocks, "pc1")["params"]["terms"]
    centres = {str(term["key"]): term["center"] for term in terms}
    assert centres == pytest.approx({"甲": 2.5, "乙": 5.0, "丙": 5.0})
    assert [str(term["key"]) for term in terms] == ["乙", "甲", "丙"]
    assert axis_row(blocks, "pc1")["params"]["explained"] == pytest.approx(1.0)
    assert axis_row(blocks, "pc2")["params"]["cumulative"] == pytest.approx(1.0)
    assert axis_row(blocks, "pc1")["params"]["terms_total"] == 3


def test_a_wide_axis_only_lists_its_biggest_terms() -> None:
    """列多于上限时公式只列前几项，并说清一共有多少项。"""
    blocks = blocks_of(wide_numbers(12, 40), n_components=2)
    row = axis_row(blocks, "pc1")
    assert len(row["params"]["terms"]) == MAX_TERMS
    assert row["params"]["terms_total"] == 12
    assert hints_of(blocks["fits"]) == [
        "每条轴只列了权重绝对值最大的前 6 项，完整的一组权重在载荷矩阵里"
    ]


def test_the_labels_are_cut_exactly_where_the_matrix_is() -> None:
    """25 列 × 25 条轴：矩阵截到 20×20，两侧标签必须跟着截到同一处。

    ⚠ 标签不截的话，热力图第 21 行起对着的是错的那条轴，而图上一点看不出来。
    """
    blocks = blocks_of(wide_numbers(25, 30), n_components=25)
    payload = blocks["structure"].payload
    assert len(payload["loadings"]) == MAX_LOADINGS
    assert len(payload["loadings"][0]) == MAX_LOADING_WIDTH
    assert payload["loading_rows"] == [
        f"pc{seat + 1}" for seat in range(MAX_LOADINGS)
    ]
    assert len(payload["loading_columns"]) == MAX_LOADING_WIDTH
    assert payload["loading_columns"][0] == "很长的列名字第0列"
    assert payload["is_loadings_cut"] is True
    assert hints_of(blocks["structure"]) == [
        "轴或列太多，载荷矩阵只画得下前 20 条轴 × 前 20 列"
    ]


def test_the_step_block_counts_the_compression() -> None:
    """压缩说明：换掉哪几列、换来哪几条轴、一共解释掉多少方差。"""
    blocks = blocks_of(one_direction(), n_components=2)
    payload = blocks["columns"].payload
    assert payload["added"] == ["pc1", "pc2"]
    assert payload["removed"] == ["甲", "乙", "丙"]
    assert payload["kept"] == 2
    assert payload["reason"] == (
        "在 4 行训练行上把 3 列压成 2 条主成分轴，合计解释掉原始方差的 100.0%"
    )
    assert hints_of(blocks["columns"]) == [OPAQUE_NOTE, BLANK_NOTE]


def test_a_missing_scree_reads_as_missing_not_as_zero() -> None:
    """拿不到解释方差时给 `None` 不给 0：0 会被读成「这条轴什么都没解释掉」。

    ⚠ 中心点同理：少一个中心点的那一项不许印成 `−0`。
    """
    blocks = {
        block.kind: block
        for block in pca_blocks(
            PcaRun(
                columns=("甲", "乙"),
                made=("pc1",),
                mean=(2.5,),
                components=((0.6, 0.8),),
                explained=(),
                kept=1,
                train_rows=4,
                total_rows=4,
            )
        )
    }
    assert blocks["structure"].payload["explained"] == []
    assert blocks["structure"].payload["cumulative"] == []
    row = axis_row(blocks, "pc1")
    assert row["params"]["explained"] is None
    assert row["params"]["cumulative"] is None
    assert [term["center"] for term in row["params"]["terms"]] == [None, 2.5]
    assert "合计解释掉" not in blocks["columns"].payload["reason"]


def test_the_worst_pca_load_still_fits_the_report_budget() -> None:
    """60 列宽帧 × 366 天逐时压成 20 条轴：讲解装得下，一块都不用降档丢掉。"""
    operator, _ = registry.build("pca", {"n_components": 20})
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    operator.run({"frame": wide_numbers(WIDE_COLUMNS, YEAR_ROWS)})
    report = report_budget.fit_report(operator.report())
    assert report is not None
    assert report["dropped"] == []
    assert report_budget.size_of(report) < REPORT_MAX_BYTES
    assert len(report["blocks"]) == 3
