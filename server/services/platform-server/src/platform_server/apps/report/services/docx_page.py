"""Word 纸张、页眉页脚、水印及目录设置。"""

from xml.sax.saxutils import quoteattr

from docx.document import Document
from docx.enum.section import WD_ORIENT
from docx.shared import Cm, Pt
from docx.styles.style import ParagraphStyle

from platform_server.apps.report.schemas.document import PageSettings
from platform_server.apps.report.services.ooxml import append_xml
from platform_server.apps.report.services.watermark import watermark_xml

_PAPERS = {
    "A4": (21.0, 29.7),
    "A3": (29.7, 42.0),
    "Letter": (21.59, 27.94),
    "Legal": (21.59, 35.56),
}


def apply_page(document: Document, page: PageSettings) -> None:
    """设置纸张和正文默认样式。Args: document, page。"""
    section = document.sections[0]
    width, height = _PAPERS.get(page.size, (page.width_cm, page.height_cm))
    if page.orientation == "landscape":
        width, height = max(width, height), min(width, height)
        section.orientation = WD_ORIENT.LANDSCAPE
    if (
        page.margins_cm.left + page.margins_cm.right >= width
        or page.margins_cm.top + page.margins_cm.bottom >= height
    ):
        raise ValueError("页边距超过纸张可用范围")
    section.page_width, section.page_height = Cm(width), Cm(height)
    for side in ("top", "bottom", "left", "right"):
        setattr(section, f"{side}_margin", Cm(getattr(page.margins_cm, side)))
    section.header.paragraphs[0].text = page.header
    section.footer.paragraphs[0].text = page.footer
    style = document.styles["Normal"]
    if isinstance(style, ParagraphStyle):
        style.font.name = page.font_family
        style.font.size = Pt(page.font_size_pt)
    if page.watermark and page.watermark.text:
        _watermark(document, page)
    if page.is_toc_enabled:
        _toc(document)


def _watermark(document: Document, page: PageSettings) -> None:
    watermark = page.watermark
    if watermark is None:
        return
    append_xml(
        document.sections[0].header.paragraphs[0].add_run(),
        watermark_xml(watermark),
    )


def _toc(document: Document) -> None:
    document.add_heading("目录", level=1)
    instruction = quoteattr('TOC \\o "1-3" \\h \\z \\u')
    append_xml(
        document.add_paragraph(),
        '<w:fldSimple xmlns:w="http://schemas.openxmlformats.org/'
        f'wordprocessingml/2006/main" w:instr={instruction}/>',
    )
    append_xml(
        document.settings,
        '<w:updateFields xmlns:w="http://schemas.openxmlformats.org/'
        'wordprocessingml/2006/main" w:val="true"/>',
    )
