"""报告静态表格的 Word 与编辑器单元格跨度映射。"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import cast

from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph

from platform_server.apps.report.schemas.document import DocumentNode
from platform_server.apps.report.services.ooxml import XmlElement

MAX_SPAN = 100
MAX_EXPANDED_TABLE_CELLS = 10_000


def _identity(cell: object) -> int:
    return id(vars(cell)["_tc"])


def import_table(
    table: Table, convert: Callable[[Paragraph | Table], DocumentNode]
) -> DocumentNode:
    """保留行顺序、合并跨度及嵌套表格。Args: table, convert。"""
    grid = [list(row.cells) for row in table.rows]
    seen: set[int] = set()
    rows: list[DocumentNode] = []
    for row_index, cells in enumerate(grid):
        content: list[DocumentNode] = []
        for column, cell in enumerate(cells):
            identity = _identity(cell)
            if identity in seen:
                continue
            seen.add(identity)
            colspan = _horizontal_span(cells, column, identity)
            rowspan = 1
            for below in grid[row_index + 1 :]:
                if column >= len(below) or _identity(below[column]) != identity:
                    break
                rowspan += 1
            content.append(
                DocumentNode(
                    type=(
                        "tableHeader"
                        if _is_header(table, row_index)
                        else "tableCell"
                    ),
                    attrs={"colspan": colspan, "rowspan": rowspan},
                    content=[
                        convert(block) for block in cell.iter_inner_content()
                    ],
                )
            )
        rows.append(DocumentNode(type="tableRow", content=content))
    return DocumentNode(type="table", content=rows)


def _horizontal_span(
    cells: Sequence[object], column: int, identity: int
) -> int:
    span = 1
    for cell in cells[column + 1 :]:
        if _identity(cell) != identity:
            break
        span += 1
    return span


def _is_header(table: Table, row_index: int) -> bool:
    element = cast(XmlElement, vars(table.rows[row_index])["_tr"])
    properties = element.find(qn("w:trPr"))
    return (
        properties is not None
        and properties.find(qn("w:tblHeader")) is not None
    )


@dataclass(frozen=True)
class CellPlacement:
    """一个可见单元格在展开网格中的位置。"""

    row: int
    column: int
    index: int
    rowspan: int
    colspan: int


def table_placements(rows: list[DocumentNode]) -> list[CellPlacement]:
    """根据原生 colspan/rowspan 推导网格位置。Args: rows。"""
    occupied: set[tuple[int, int]] = set()
    placements: list[CellPlacement] = []
    width = 0
    for row_index, row in enumerate(rows):
        column = 0
        for index, cell in enumerate(row.content):
            while (row_index, column) in occupied:
                column += 1
            rowspan = _span(cell, "rowspan")
            colspan = _span(cell, "colspan")
            if row_index + rowspan > len(rows):
                raise ValueError("表格合并单元格超过行范围")
            width = max(width, column + colspan)
            if len(rows) * width > MAX_EXPANDED_TABLE_CELLS:
                raise ValueError(
                    "表格展开网格超过 10000 格，请减少行数或合并跨度"
                )
            region = {
                (vertical, horizontal)
                for vertical in range(row_index, row_index + rowspan)
                for horizontal in range(column, column + colspan)
            }
            if region & occupied:
                raise ValueError("表格合并单元格存在重叠，请检查合并范围")
            placements.append(
                CellPlacement(row_index, column, index, rowspan, colspan)
            )
            occupied.update(region)
            column += colspan
    return placements


def _span(cell: DocumentNode, name: str) -> int:
    value = cell.attrs.get(name, 1)
    if (
        not isinstance(value, int)
        or isinstance(value, bool)
        or not 1 <= value <= MAX_SPAN
    ):
        raise ValueError("表格合并跨度必须是 1～100 的整数")
    return value
