"""报告表格的边框、表头、行间留白与跨页控制。"""

import re
from typing import Protocol

from docx.document import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Emu, Pt
from docx.table import Table
from docx.text.paragraph import Paragraph

from platform_server.apps.report.services.ooxml import append_property
from platform_server.apps.report.services.typography import set_font_size

_W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


class Cell(Protocol):
    """表格单元格需要的排版写面。"""

    @property
    def text(self) -> str: ...

    @property
    def paragraphs(self) -> list[Paragraph]: ...


def format_table(table: Table, document: Document) -> None:
    """应用统一表格样式，保留数据和显式的文字格式。Args: table, document。"""
    section = document.sections[0]
    width = (
        int(section.page_width or 0)
        - int(section.left_margin or 0)
        - int(section.right_margin or 0)
    )
    table.autofit = False
    for column in table.columns:
        column.width = Emu(int(width / len(table.columns)))
    borders = "".join(
        f'<w:{edge} w:val="single" w:sz="4" w:color="D9D9D9"/>'
        for edge in ("top", "left", "bottom", "right", "insideH", "insideV")
    )
    append_property(
        table,
        "tblPr",
        f'<w:tblBorders xmlns:w="{_W_NS}">{borders}</w:tblBorders>',
        "_tbl",
    )
    for index, row in enumerate(table.rows):
        append_property(row, "trPr", f'<w:cantSplit xmlns:w="{_W_NS}"/>', "_tr")
        for cell in row.cells:
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            _format_cell(cell, index)


def _format_cell(cell: Cell, index: int) -> None:
    """设置单元格留白和数字对齐。Args: cell, index。"""
    color = (
        "E8EEF4" if index == 0 else ("F7F9FB" if index % 2 == 0 else "FFFFFF")
    )
    append_property(
        cell,
        "tcPr",
        f'<w:shd xmlns:w="{_W_NS}" w:fill="{color}"/>',
        "_tc",
    )
    append_property(
        cell,
        "tcPr",
        f'<w:tcMar xmlns:w="{_W_NS}">'
        '<w:top w:w="40" w:type="dxa"/>'
        '<w:bottom w:w="40" w:type="dxa"/>'
        '<w:left w:w="100" w:type="dxa"/>'
        '<w:right w:w="100" w:type="dxa"/></w:tcMar>',
        "_tc",
    )
    for paragraph in cell.paragraphs:
        paragraph.paragraph_format.line_spacing = Pt(15)
        paragraph.paragraph_format.space_before = Pt(0)
        paragraph.paragraph_format.space_after = Pt(0)
        if index == 0:
            paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        elif re.fullmatch(r"[+-]?\d+(?:\.\d+)?", cell.text.strip()):
            paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        for run in paragraph.runs:
            if run.font.size is None:
                set_font_size(run.font, 10.5)
            if index == 0:
                run.bold = True
