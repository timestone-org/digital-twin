"""报告的字体与段落层级，显式覆盖 Word 内置主题的字体回退。"""

from typing import cast

from docx.document import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor
from docx.styles.style import ParagraphStyle
from docx.text.font import Font

from platform_server.apps.report.schemas.document import PageSettings
from platform_server.apps.report.services.ooxml import (
    XmlElement,
    append_property,
    remove_property,
)


def set_font_family(font: Font, family: str) -> None:
    """中西文和复杂文字统一字体并移除主题覆盖。Args: font, family。"""
    font.name = family
    element = cast(XmlElement, vars(font)["_element"])
    properties = element.find(qn("w:rPr"))
    if properties is None:
        return
    fonts = properties.find(qn("w:rFonts"))
    if fonts is None:
        return
    for script in ("ascii", "hAnsi", "eastAsia", "cs"):
        fonts.set(qn(f"w:{script}"), family)
        fonts.attrib.pop(qn(f"w:{script}Theme"), None)
    fonts.attrib.pop(qn("w:cstheme"), None)


def set_font_size(font: Font, points: float) -> None:
    """统一普通与复杂文字字号。Args: font, points。"""
    font.size = Pt(points)
    remove_property(font, "rPr", "szCs")
    append_property(
        font,
        "rPr",
        '<w:szCs xmlns:w="http://schemas.openxmlformats.org/'
        f'wordprocessingml/2006/main" w:val="{round(points * 2)}"/>',
    )


def apply_typography(document: Document, page: PageSettings) -> None:
    """定义正文、标题、题注和页眉页脚的层级。Args: document, page。"""
    for name in (
        "Normal",
        "Title",
        "Subtitle",
        "Caption",
        "Header",
        "Footer",
        "List Bullet",
        "List Number",
    ):
        style = document.styles[name]
        if not isinstance(style, ParagraphStyle):
            continue
        set_font_family(style.font, page.font_family)
        set_font_size(style.font, page.font_size_pt)
        style.font.color.rgb = RGBColor(0, 0, 0)
        style.font.italic = False
        style.paragraph_format.widow_control = True
        style.paragraph_format.line_spacing = Pt(page.font_size_pt * 1.65)
        style.paragraph_format.space_after = Pt(6)
    remove_property(document.styles["Title"], "pPr", "pBdr")
    _title_styles(document)
    for level, size in enumerate((18, 15, 13, 12, 11, 11), start=1):
        _heading_style(document, page, level, size)


def _title_styles(document: Document) -> None:
    for name, size in (
        ("Title", 22),
        ("Subtitle", 12),
        ("Caption", 10.5),
        ("Header", 9),
        ("Footer", 9),
    ):
        style = document.styles[name]
        if not isinstance(style, ParagraphStyle):
            continue
        set_font_size(style.font, size)
        style.font.bold = name in ("Title", "Caption")
        style.paragraph_format.line_spacing = Pt(size * 1.4)
        style.paragraph_format.keep_with_next = name not in ("Header", "Footer")
        style.paragraph_format.space_after = Pt(14 if name == "Title" else 6)
        if name in ("Title", "Header", "Footer"):
            style.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.CENTER


def _heading_style(
    document: Document, page: PageSettings, level: int, size: float
) -> None:
    style = document.styles[f"Heading {level}"]
    if not isinstance(style, ParagraphStyle):
        return
    set_font_family(style.font, page.font_family)
    set_font_size(style.font, size)
    style.font.bold = True
    style.font.color.rgb = RGBColor(0, 0, 0)
    paragraph = style.paragraph_format
    paragraph.line_spacing = Pt(size * 1.4)
    paragraph.space_before = Pt(16 if level in (1, 2) else 10)
    paragraph.space_after = Pt(6)
    paragraph.keep_with_next = True
    paragraph.keep_together = True
    paragraph.widow_control = True


def point_size(value: str) -> float | None:
    """将编辑器 CSS 字号换算为磅。Args: value。"""
    text = value.strip().lower()
    multiplier = 0.75 if text.endswith("px") else 1.0
    number = text.removesuffix("pt").removesuffix("px")
    if not number.replace(".", "", 1).isdigit():
        return None
    return min(72, max(6, float(number) * multiplier))
