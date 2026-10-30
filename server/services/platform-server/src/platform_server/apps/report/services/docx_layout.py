"""将真实编辑器的段落属性写回 Word，单位在边界统一换算。"""

import math
import re

from docx.shared import Pt
from docx.text.paragraph import Paragraph
from pydantic import JsonValue

from platform_server.apps.report.schemas.document import DocumentNode

PIXELS_TO_POINTS = 0.75
DEFAULT_FONT_POINTS = 12
INDENT_SIZE = 2
_LENGTH = re.compile(r"^(-?\d+(?:\.\d+)?)(pt|px|cm|mm)?$")
_UNIT_POINTS = {"pt": 1.0, "px": 0.75, "cm": 72 / 2.54, "mm": 72 / 25.4}
MAX_COLOR_CHANNEL = 255
_RGB = re.compile(
    r"^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(1(?:\.0+)?))?\s*\)$",
    re.IGNORECASE,
)


def normalize_text_color(value: str) -> str | None:
    """收敛浏览器产生的安全不透明 CSS 颜色。Args: value。"""
    color = value.strip()
    if re.fullmatch(r"#[0-9a-fA-F]{6}", color):
        return color[1:].upper()
    if re.fullmatch(r"#[0-9a-fA-F]{3}", color):
        return "".join(character * 2 for character in color[1:]).upper()
    match = _RGB.fullmatch(color)
    if (
        match is None
        or (color.lower().startswith("rgba")
        and match.group(4) is None)
    ):
        return None
    channels = [int(match.group(index)) for index in (1, 2, 3)]
    if any(channel > MAX_COLOR_CHANNEL for channel in channels):
        return None
    return "".join(f"{channel:02X}" for channel in channels)


def _number(value: JsonValue) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value) if math.isfinite(value) else None
    return None


def apply_paragraph_layout(paragraph: Paragraph, node: DocumentNode) -> None:
    """写入精确缩进、段间距与行距。Args: paragraph, node。"""
    formatting = paragraph.paragraph_format
    for name, target in (
        ("leftIndentPt", "left_indent"),
        ("rightIndentPt", "right_indent"),
        ("firstLineIndentPt", "first_line_indent"),
    ):
        points = _number(node.attrs.get(name))
        if points is not None:
            setattr(formatting, target, Pt(points))
    if _number(node.attrs.get("firstLineIndentPt")) is None:
        _native_indent(paragraph, node)
    margin = node.attrs.get("margin")
    if isinstance(margin, dict):
        for source, target in (
            ("top", "space_before"),
            ("bottom", "space_after"),
        ):
            value = margin.get(source)
            pixels = _number(value)
            if pixels is None and isinstance(value, str):
                try:
                    pixels = float(value)
                except ValueError:
                    continue
            if pixels is not None and math.isfinite(pixels):
                setattr(formatting, target, Pt(pixels * PIXELS_TO_POINTS))
    _line_height(paragraph, node.attrs.get("lineHeight"))


def _native_indent(paragraph: Paragraph, node: DocumentNode) -> None:
    level = _number(node.attrs.get("indent"))
    unit = node.attrs.get("indentUnit") or "em"
    if level is None or not isinstance(unit, str):
        return
    style = paragraph.style
    font_size = style.font.size if style is not None else None
    multiplier = (
        (font_size.pt if font_size is not None else DEFAULT_FONT_POINTS)
        if unit == "em"
        else _UNIT_POINTS.get(unit)
    )
    if multiplier is not None:
        paragraph.paragraph_format.first_line_indent = Pt(
            level * INDENT_SIZE * multiplier
        )


def _line_height(paragraph: Paragraph, value: JsonValue) -> None:
    multiple = _number(value)
    if multiple is not None and multiple > 0:
        paragraph.paragraph_format.line_spacing = multiple
        return
    if not isinstance(value, str):
        return
    match = _LENGTH.fullmatch(value.strip())
    if match is None:
        return
    number = float(match.group(1))
    unit = match.group(2)
    if number <= 0 or not math.isfinite(number):
        return
    paragraph.paragraph_format.line_spacing = (
        Pt(number * _UNIT_POINTS[unit]) if unit else number
    )
