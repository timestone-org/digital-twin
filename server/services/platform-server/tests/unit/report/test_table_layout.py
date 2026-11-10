"""报告表格排版写进单元格属性的那几项：每格一份、顺序合规。

⚠ python-docx 的 `row.cells` 对合并格按跨列、跨行各回一次同一个 `tc`：逐个
排版会给它叠出几份 `w:shd` / `w:tcMar`，而这两项在 schema 里最多一个。
"""

from docx import Document
from docx.oxml.ns import qn

from platform_server.apps.report.services.table_layout import format_table


def merged_table_properties() -> list[list[str]]:
    """排版一张 3×3、首行横向合并且首列纵向合并的表，回每格 tcPr 的子元素名。"""
    document = Document()
    table = document.add_table(rows=3, cols=3)
    table.cell(0, 0).merge(table.cell(0, 2))
    table.cell(1, 0).merge(table.cell(2, 0))
    format_table(table, document)
    return [
        [child.tag.split("}")[1] for child in properties]
        for properties in table._tbl.iter(qn("w:tcPr"))
    ]


def test_a_merged_cell_gets_at_most_one_shading_and_one_margin() -> None:
    # 纵向合并的续格（只有 vMerge）沿用首格的属性，本身不排
    formatted = [names for names in merged_table_properties() if "shd" in names]
    assert len(formatted) == 6
    for names in merged_table_properties():
        assert names.count("shd") <= 1
        assert names.count("tcMar") <= 1


def test_shading_and_margins_precede_the_vertical_alignment() -> None:
    for names in merged_table_properties():
        if "shd" in names:
            shading, margins = names.index("shd"), names.index("tcMar")
            assert shading < margins < names.index("vAlign")
