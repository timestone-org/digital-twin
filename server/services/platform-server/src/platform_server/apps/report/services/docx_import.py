"""有界 Word 导入，保留段落与表格并报告不支持的内容。"""

import io
import zipfile

from docx import Document
from docx.enum.section import WD_ORIENT
from docx.table import Table
from docx.text.paragraph import Paragraph

from platform_server.apps.report.schemas.document import (
    DocumentMark,
    DocumentNode,
    Margins,
    PageSettings,
)
from platform_server.apps.report.schemas.jobs import ImportResultOut

MAX_IMPORT_BYTES = 10 * 1024 * 1024
MAX_EXPANDED_BYTES = 50 * 1024 * 1024
MAX_ENTRIES = 2000


def validate_archive(payload: bytes) -> None:
    """限制压缩包大小、解压总量和条目数。Args: payload。"""
    if len(payload) > MAX_IMPORT_BYTES:
        raise ValueError("Word 文件超过 10 MB")
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        entries = archive.infolist()
        if (
            len(entries) > MAX_ENTRIES
            or sum(entry.file_size for entry in entries) > MAX_EXPANDED_BYTES
        ):
            raise ValueError("Word 解压后体积超过上限")
        if "word/document.xml" not in archive.namelist():
            raise ValueError("不是有效的 Word 文档")


def import_docx(payload: bytes) -> ImportResultOut:
    """转换 Word 并如实报告丢失内容。Args: payload。"""
    validate_archive(payload)
    document = Document(io.BytesIO(payload))
    content = [_block(block) for block in document.iter_inner_content()]
    section = document.sections[0]
    margins = Margins(
        **{
            side: round(float(getattr(section, f"{side}_margin")) / 360000, 4)
            for side in ("top", "bottom", "left", "right")
        }
    )
    page = PageSettings(
        size="custom",
        width_cm=float(section.page_width or 7560000) / 360000,
        height_cm=float(section.page_height or 10692000) / 360000,
        orientation=(
            "landscape"
            if section.orientation == WD_ORIENT.LANDSCAPE
            else "portrait"
        ),
        margins_cm=margins,
        header="\n".join(item.text for item in section.header.paragraphs),
        footer="\n".join(item.text for item in section.footer.paragraphs),
    )
    dropped: list[str] = []
    if document.inline_shapes:
        dropped.append(f"图片或图表 {len(document.inline_shapes)} 个未导入")
    if len(document.sections) > 1:
        dropped.append("多节页面设置仅保留第一节")
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        if any(
            name.startswith(
                ("word/footnotes", "word/endnotes", "word/comments")
            )
            for name in archive.namelist()
        ):
            dropped.append("脚注、尾注及批注未导入")
        document_xml = archive.read("word/document.xml")
        if b"w:gridSpan" in document_xml or b"w:vMerge" in document_xml:
            dropped.append("合并单元格已展开")
        if b"w:numPr" in document_xml:
            dropped.append("列表自动编号转为普通段落")
    return ImportResultOut(
        doc_json=DocumentNode(type="doc", content=content),
        page_json=page,
        dropped=dropped,
    )


def _block(block: Paragraph | Table) -> DocumentNode:
    if isinstance(block, Paragraph):
        return _paragraph(block)
    rows = [
        DocumentNode(
            type="tableRow",
            content=[
                DocumentNode(
                    type="tableCell",
                    content=[
                        _paragraph(paragraph) for paragraph in cell.paragraphs
                    ],
                )
                for cell in row.cells
            ],
        )
        for row in block.rows
    ]
    return DocumentNode(type="table", content=rows)


def _paragraph(paragraph: Paragraph) -> DocumentNode:
    nodes: list[DocumentNode] = []
    for run in paragraph.runs:
        marks = [
            DocumentMark(type=name)
            for name, active in (
                ("bold", run.bold),
                ("italic", run.italic),
                ("underline", run.underline),
                ("strike", run.font.strike),
            )
            if active
        ]
        if run.text:
            nodes.append(DocumentNode(type="text", text=run.text, marks=marks))
    style_name = paragraph.style.name if paragraph.style is not None else ""
    if (
        style_name
        and style_name.startswith("Heading ")
        and style_name[-1].isdigit()
    ):
        return DocumentNode(
            type="heading", attrs={"level": int(style_name[-1])}, content=nodes
        )
    return DocumentNode(type="paragraph", content=nodes)
