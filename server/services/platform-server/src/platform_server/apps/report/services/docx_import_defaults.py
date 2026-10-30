"""读取 Word 文档级默认字体、段落间距与主题西文字体。"""

from copy import deepcopy
from dataclasses import dataclass
from typing import cast

from docx.document import Document
from docx.opc.constants import RELATIONSHIP_TYPE
from docx.oxml import parse_xml
from docx.oxml.text.font import CT_RPr
from docx.oxml.text.paragraph import CT_P
from docx.oxml.text.parfmt import CT_PPr
from docx.oxml.text.run import CT_R
from docx.text.font import Font
from docx.text.parfmt import ParagraphFormat

from platform_server.apps.report.services.ooxml import XmlElement

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"


@dataclass(frozen=True)
class DocumentDefaults:
    """不向原件回写的文档缺省格式。"""

    font: Font
    paragraph: ParagraphFormat


def document_defaults(document: Document) -> DocumentDefaults:
    """将文档默认属性收敛为 python-docx 的格式读口。Args: document。"""
    styles = cast(XmlElement, document.styles.element)
    run = cast(CT_R, parse_xml(f'<w:r xmlns:w="{_W[1:-1]}"/>'.encode()))
    paragraph = cast(CT_P, parse_xml(f'<w:p xmlns:w="{_W[1:-1]}"/>'.encode()))
    run_properties = styles.find(f"{_W}docDefaults/{_W}rPrDefault/{_W}rPr")
    if run_properties is not None:
        cast(XmlElement, run).append(deepcopy(cast(CT_RPr, run_properties)))
    paragraph_properties = styles.find(
        f"{_W}docDefaults/{_W}pPrDefault/{_W}pPr"
    )
    if paragraph_properties is not None:
        cast(XmlElement, paragraph).append(
            deepcopy(cast(CT_PPr, paragraph_properties))
        )
    font = Font(run)
    if font.name is None:
        family = _theme_family(document)
        if family:
            font.name = family
    return DocumentDefaults(font, ParagraphFormat(paragraph))


def _theme_family(document: Document) -> str | None:
    try:
        part = document.part.part_related_by(RELATIONSHIP_TYPE.THEME)
    except (KeyError, ValueError):
        return None
    theme = cast(XmlElement, parse_xml(part.blob))
    latin = theme.find(
        f"{_A}themeElements/{_A}fontScheme/{_A}minorFont/{_A}latin"
    )
    return latin.attrib.get("typeface") if latin is not None else None
