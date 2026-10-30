"""把 Word 的有效字体和段落样式映射为已登记的编辑器属性。"""

from collections.abc import Iterator
from typing import cast

from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml.ns import qn
from docx.shared import Length
from docx.styles.style import ParagraphStyle
from docx.text.font import Font
from docx.text.paragraph import Paragraph
from docx.text.run import Run
from pydantic import JsonValue

from platform_server.apps.report.schemas.document import DocumentMark
from platform_server.apps.report.services.docx_import_defaults import (
    DocumentDefaults,
)
from platform_server.apps.report.services.ooxml import XmlElement

POINTS_TO_PIXELS = 4 / 3
MIN_FONT_POINTS = 6
MAX_FONT_POINTS = 72


def _styles(paragraph: Paragraph) -> Iterator[ParagraphStyle]:
    style = paragraph.style
    visited: set[str] = set()
    while isinstance(style, ParagraphStyle) and style.style_id not in visited:
        visited.add(style.style_id)
        yield style
        parent = style.base_style
        style = parent if isinstance(parent, ParagraphStyle) else None


def _fonts(
    run: Run, paragraph: Paragraph, defaults: DocumentDefaults
) -> list[Font]:
    return [
        run.font,
        run.style.font,
        *(style.font for style in _styles(paragraph)),
        defaults.font,
    ]


def _font_property(fonts: list[Font], name: str) -> object:
    for font in fonts:
        value: object = getattr(font, name)
        if value is not None:
            return value
    return None


def _family(fonts: list[Font], warnings: list[str]) -> str | None:
    for font in fonts:
        element = cast(XmlElement, vars(font)["_element"])
        properties = element.find(qn("w:rPr"))
        names = (
            properties.find(qn("w:rFonts")) if properties is not None else None
        )
        if names is not None and any(
            name.casefold().endswith("theme") for name in names.attrib
        ):
            warnings.append("主题字体已转为固定字体，请核对中西文字形")
        eastern = (
            names.attrib.get(qn("w:eastAsia")) if names is not None else None
        )
        if eastern:
            if font.name and font.name != eastern:
                warnings.append("分别设置的中西文字体已统一为东亚字体")
            return eastern
        if font.name:
            return font.name
    return None


def _text_style(fonts: list[Font], warnings: list[str]) -> DocumentMark | None:
    attrs: dict[str, JsonValue] = {}
    family = _family(fonts, warnings)
    if family:
        attrs["fontFamily"] = family
    size = _font_property(fonts, "size")
    if isinstance(size, Length):
        attrs["fontSize"] = f"{size.pt:g}pt"
        if not MIN_FONT_POINTS <= size.pt <= MAX_FONT_POINTS:
            warnings.append("超出 6～72 磅的字号将限制到编辑器支持范围")
    for font in fonts:
        if font.color.rgb is not None:
            attrs["color"] = f"#{font.color.rgb}"
            break
        if font.color.type is not None:
            warnings.append("主题或自动文字颜色采用报告默认颜色")
            break
    return DocumentMark(type="textStyle", attrs=attrs) if attrs else None


def run_marks(
    run: Run,
    paragraph: Paragraph,
    warnings: list[str],
    defaults: DocumentDefaults,
) -> list[DocumentMark]:
    """解析直接格式与字符、段落样式继承。Args: run, paragraph, warnings。"""
    fonts = _fonts(run, paragraph, defaults)
    marks = [
        DocumentMark(type=name)
        for name, property_name in (
            ("bold", "bold"),
            ("italic", "italic"),
            ("underline", "underline"),
            ("strike", "strike"),
            ("subscript", "subscript"),
            ("superscript", "superscript"),
        )
        if _font_property(fonts, property_name)
    ]
    text_style = _text_style(fonts, warnings)
    if text_style is not None:
        marks.append(text_style)
    if run.font.highlight_color is not None:
        warnings.append("文字突出显示颜色未导入")
    if run.underline not in (None, True, False):
        warnings.append("复杂下划线样式已转换为单线")
    if any(
        getattr(run.font, name) is False and _font_property(fonts[1:], name)
        for name in ("bold", "italic", "underline", "strike")
    ):
        warnings.append("显式关闭的继承文字格式未保留，标题和表格等样式需核对")
    return marks


def _paragraph_property(
    paragraph: Paragraph, name: str, defaults: DocumentDefaults
) -> object:
    formats = [
        paragraph.paragraph_format,
        *(style.paragraph_format for style in _styles(paragraph)),
        defaults.paragraph,
    ]
    for formatting in formats:
        value: object = getattr(formatting, name)
        if value is not None:
            return value
    return None


def paragraph_attrs(
    paragraph: Paragraph, warnings: list[str], defaults: DocumentDefaults
) -> dict[str, JsonValue]:
    """提取对齐、精确缩进和编辑器支持的间距。Args: paragraph, warnings。"""
    attrs: dict[str, JsonValue] = {}
    alignments = {
        WD_ALIGN_PARAGRAPH.LEFT: "left",
        WD_ALIGN_PARAGRAPH.CENTER: "center",
        WD_ALIGN_PARAGRAPH.RIGHT: "right",
        WD_ALIGN_PARAGRAPH.JUSTIFY: "justify",
        WD_ALIGN_PARAGRAPH.DISTRIBUTE: "distributed",
    }
    alignment = _paragraph_property(paragraph, "alignment", defaults)
    if isinstance(alignment, WD_ALIGN_PARAGRAPH) and alignment in alignments:
        attrs["textAlign"] = alignments[alignment]
    for word, editor in (
        ("left_indent", "leftIndentPt"),
        ("right_indent", "rightIndentPt"),
        ("first_line_indent", "firstLineIndentPt"),
    ):
        value = _paragraph_property(paragraph, word, defaults)
        if isinstance(value, Length):
            attrs[editor] = value.pt
    attrs.update(_spacing(paragraph, warnings, defaults))
    if paragraph.paragraph_format.tab_stops:
        warnings.append("自定义制表位未导入，制表文字保留")
    _paragraph_style_warnings(paragraph, warnings)
    return attrs


def _paragraph_style_warnings(
    paragraph: Paragraph, warnings: list[str]
) -> None:
    for owner in [paragraph, *_styles(paragraph)]:
        element = cast(XmlElement, vars(owner)["_element"])
        properties = element.find(qn("w:pPr"))
        if properties is None:
            continue
        for name, label in (("pBdr", "边框"), ("shd", "底纹")):
            if properties.find(qn(f"w:{name}")) is not None:
                warnings.append(f"段落{label}未导入")


def _spacing(
    paragraph: Paragraph, warnings: list[str], defaults: DocumentDefaults
) -> dict[str, JsonValue]:
    attrs: dict[str, JsonValue] = {}
    margin: dict[str, JsonValue] = {}
    for word, editor in (("space_before", "top"), ("space_after", "bottom")):
        value = _paragraph_property(paragraph, word, defaults)
        if isinstance(value, Length):
            margin[editor] = round(value.pt * POINTS_TO_PIXELS, 6)
    if margin:
        attrs["margin"] = margin
    spacing = _paragraph_property(paragraph, "line_spacing", defaults)
    if isinstance(spacing, Length):
        attrs["lineHeight"] = f"{spacing.pt:g}pt"
    elif isinstance(spacing, (int, float)):
        attrs["lineHeight"] = spacing
    if (
        _paragraph_property(paragraph, "line_spacing_rule", defaults)
        == WD_LINE_SPACING.AT_LEAST
    ):
        warnings.append("最小行距已转换为固定行距，请核对换行和分页")
    return attrs
