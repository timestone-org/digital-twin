"""镜像慢闸：现造带 Word 图形的 DOCX，经生产派生器把 PDF 写到 stdout。"""

import asyncio
import sys
from io import BytesIO
from typing import cast

from docx import Document
from docx.oxml import parse_xml
from docx.oxml.document import CT_Body

from knowledge_server.apps.knowledge.services.docx_preview import (
    LibreOfficeDocxPreviewer,
)
from knowledge_server.apps.knowledge.services.parsing import RawItem

_SHAPE_PARAGRAPH = """<w:p
 xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:v="urn:schemas-microsoft-com:vml"><w:r><w:pict><v:rect id="shape1"
 style="width:240pt;height:120pt" fillcolor="#ff0000" strokecolor="#000000">
 <v:textbox><w:txbxContent><w:p><w:r><w:t>SHAPE-SENTINEL</w:t></w:r></w:p>
 </w:txbxContent></v:textbox></v:rect></w:pict></w:r></w:p>"""


def _shape_docx() -> bytes:
    """造一份有效、带红色 Word 图形的 DOCX。"""
    document = Document()
    body = cast(
        CT_Body,
        # python-docx 的 stub 漏了 XMLchemy 动态生成的 body 描述符
        document.element.body,  # pyright: ignore[reportUnknownMemberType]
    )
    # python-docx 的 CT_Body stub 继承未标注的 lxml insert
    body.insert(  # pyright: ignore[reportUnknownMemberType]
        len(body) - 1, parse_xml(_SHAPE_PARAGRAPH)
    )
    target = BytesIO()
    document.save(target)
    return target.getvalue()


async def _render() -> bytes:
    """走生产派生器并校验基础 PDF 形状。"""
    made = await LibreOfficeDocxPreviewer(
        executable="soffice", timeout_s=30
    ).render(
        RawItem(filename="shape.docx", media_type="", content=_shape_docx())
    )
    if made is None or not made.content.startswith(b"%PDF-"):
        raise RuntimeError("DOCX 图形样件没有产出 PDF")
    return made.content


def main() -> None:
    """只把 PDF 字节写到 stdout，供宿主的 Poppler 做像素断言。"""
    sys.stdout.buffer.write(asyncio.run(_render()))


if __name__ == "__main__":
    main()
