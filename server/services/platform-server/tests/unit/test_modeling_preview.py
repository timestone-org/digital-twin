"""结果摘要的用例：上限、降档、两个截断标志各自为真。"""

import json

from platform_server.apps.modeling.operators import (
    CellValue,
    Frame,
    FrameColumn,
)
from platform_server.apps.modeling.services import preview


def big_frame(rows: int, cols: int) -> Frame:
    """造一个大帧。

    Args: rows, cols。
    """
    columns = tuple(
        FrameColumn(key=f"c{index}", name=f"列{index}", dtype="number")
        for index in range(cols)
    )
    matrix: list[tuple[CellValue, ...]] = [
        tuple(float(row * index % 97) for index in range(cols))
        for row in range(rows)
    ]
    return Frame(columns=columns, rows=tuple(matrix))


def test_a_huge_frame_is_capped_by_rows_and_columns() -> None:
    """十万行两百列进来，出去的摘要只有上限那么多行与列。"""
    summary = preview.summarize(big_frame(100_000, 200))
    assert len(summary["head"]) == preview.PREVIEW_ROWS
    assert len(summary["columns"]) == preview.PREVIEW_COLS


def test_row_and_column_truncation_are_flagged_separately() -> None:
    """行截断与列截断**各有各的标志位**：只置一个，界面就分不清被切了什么。"""
    summary = preview.summarize(big_frame(100_000, 200))
    assert summary["rows_truncated"] is True
    assert summary["cols_truncated"] is True


def test_a_small_frame_is_not_flagged_as_truncated() -> None:
    """本来就这么少的帧不许被标成截断——那会劝用户去缩一个不需要缩的范围。"""
    summary = preview.summarize(big_frame(5, 3))
    assert summary["rows_truncated"] is False
    assert summary["cols_truncated"] is False


def test_the_byte_budget_is_enforced() -> None:
    """序列化之后必须压进字节上限。"""
    fitted, _ = preview.fit_budget(preview.summarize(big_frame(100_000, 200)))
    size = len(json.dumps(fitted, ensure_ascii=False).encode())
    assert size <= preview.PREVIEW_MAX_BYTES


def test_an_oversized_preview_downgrades_step_by_step() -> None:
    """超上限时逐级降到更少的行，而不是一刀切成空。"""
    wide = big_frame(preview.PREVIEW_ROWS, 60)
    fitted, truncated = preview.fit_budget(preview.summarize(wide))
    assert truncated is False
    assert len(fitted["head"]) == preview.PREVIEW_ROWS


def test_an_unknown_payload_gets_an_honest_placeholder() -> None:
    """认不出来的负载给一句明说认不出来的兜底，不静默给空。"""
    assert preview.summarize(object())["kind"] == "unknown"
