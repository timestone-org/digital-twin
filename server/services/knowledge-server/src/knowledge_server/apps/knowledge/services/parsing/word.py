"""Word 文档（.docx）：按文档序穿过段落与表格。

⚠ 段落与表格必须按**文档序**走：`Document.paragraphs` 与 `Document.tables`
是两份平行清单，各走各的会把全部表格堆到文末，而它们的标题路径于是取自最后
一个标题——第一章的表被引用成末章的。`iter_inner_content()` 才给真实先后。

⚠ 只读**文本与结构**：不取嵌入的图片、不跑宏、不跟外部引用。

⚠ 三件事各有决定，见 ADR-0043：页眉页脚**每节收一次**（文件号与版本常常只
写在那儿，而它们在文件里本来就只存一份）；脚注尾注**够不着**（python-docx
1.2 没有公开面，钻 footnotes part 等于把库的内部结构写进这里）；批注**刻意
不收**——它是审阅过程的对话，收进来会让检索答出一份还没定稿的说法。

⚠ 解析是**纯 CPU 且阻塞**的，调用方必须扔进进程池。
"""

from dataclasses import dataclass, field
from io import BytesIO

from docx import Document
from docx.document import Document as DocxDocument
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph

from knowledge_server.apps.knowledge.services.parsing.ports import (
    Block,
    Locator,
    ParsedDocument,
    RawItem,
)
from knowledge_server.apps.knowledge.services.parsing.structure import (
    cell_text,
    paired,
    path_of,
    pushed,
)

# 与纯文本那一路同一个上限，理由也同源
MAX_BLOCKS = 20_000

_DOCX_SUFFIXES = (".docx",)
# 列表项的样式名前缀。⚠ 中英各一套：现场的模板多半是中文版 Word 存的
_LIST_STYLES = (
    "List Paragraph",
    "List Bullet",
    "List Number",
    "列表段落",
    "列表项目符号",
    "列表编号",
)


def _heading_level(style_name: str) -> int:
    """样式名 → 标题层级；不是标题给 0。

    ⚠ 认 `Heading N` 也认中文的「标题 N」：现场的模板多半是中文版 Word 存的，
    只认英文的话整份文档一个标题都解不出来，而那正是切块质量的主要来源。

    Args: style_name。
    """
    for prefix in ("Heading ", "标题 ", "标题"):
        if style_name.startswith(prefix):
            tail = style_name[len(prefix) :].strip()
            if tail.isdigit():
                return int(tail)
    return 0


def _style_name(paragraph: Paragraph) -> str:
    """这一段挂的样式名；没挂给空串。

    Args: paragraph。
    """
    style = paragraph.style
    return "" if style is None else (style.name or "")


def _list_level(style_name: str) -> int:
    """列表项的嵌套深度，从 1 起；不是列表项给 0。

    ⚠ 深度只认样式名的尾数（`List Bullet 2`）。真正记着层级的是
    `w:numPr/w:ilvl`，而 python-docx 没有公开面够得着它——套着「列表段落」
    样式的多级列表因此一律算第 1 层，宁可少说也不硬猜一个层级出来。

    Args: style_name。
    """
    if not style_name.startswith(_LIST_STYLES):
        return 0
    tail = style_name[-1]
    return int(tail) if tail.isdigit() and tail != "0" else 1


def _merged(pairs: list[tuple[str, int]]) -> list[str]:
    """把横向合并的单元格折成一格。

    ⚠ `row.cells` 按**网格列**给：一个跨 3 列的单元格会连着出现 3 次。照单
    全收的话，一行合并表头变成「甲 | 甲 | 甲」，而它会折进后面的每一行。

    Args: pairs（每格的文本与它横跨几列）。
    """
    out: list[str] = []
    skip = 0
    for text, span in pairs:
        if skip > 0:
            skip -= 1
            continue
        out.append(cell_text(text))
        skip = max(0, span - 1)
    return out


@dataclass
class _Walk:
    """扫一遍文档时攒着的那几样。"""

    made: list[Block] = field(default_factory=list[Block])
    # 标题栈：层级 + 文本
    stack: list[tuple[int, str]] = field(default_factory=list[tuple[int, str]])
    # 已经摊过几张表，用来给 locator 编号
    tables: int = 0


def _paragraph_into(walk: _Walk, paragraph: Paragraph) -> None:
    """一个段落成一块：标题压栈，列表项带上嵌套深度。

    Args: walk, paragraph。
    """
    text = paragraph.text.strip()
    if not text:
        return
    name = _style_name(paragraph)
    level = _heading_level(name)
    if level > 0:
        walk.stack = pushed(walk.stack, level, text)
        walk.made.append(
            Block(
                kind="heading",
                text=text,
                level=level,
                locator=Locator(path=path_of(walk.stack)),
            )
        )
        return
    depth = _list_level(name)
    walk.made.append(
        Block(
            kind="list_item" if depth > 0 else "paragraph",
            text=text,
            level=depth,
            locator=Locator(path=path_of(walk.stack)),
        )
    )


def _table_into(walk: _Walk, table: Table) -> None:
    """一张表摊成行块，表头折进后面的每一行。

    Args: walk, table。
    """
    walk.tables += 1
    path = path_of(walk.stack)
    header: list[str] = []
    for index, row in enumerate(table.rows, start=1):
        if len(walk.made) >= MAX_BLOCKS:
            return
        cells = _merged([(one.text, one.grid_span) for one in row.cells])
        if not any(cells):
            continue
        walk.made.append(
            Block(
                kind="table_row",
                text=paired(header, cells) if header else " | ".join(cells),
                locator=Locator(
                    sheet=f"表 {walk.tables}", row=index, path=path
                ),
            )
        )
        header = header or cells


def _part_text(paragraphs: list[Paragraph]) -> str:
    """页眉或页脚里的几行拼成一句。

    Args: paragraphs。
    """
    return "\n".join(one.text.strip() for one in paragraphs if one.text.strip())


def _section_blocks(document: DocxDocument) -> list[Block]:
    """每一节的页眉页脚各收一次。

    ⚠ 只收一次而不是每页一次：它们在文件里本来就只存一份，Word 的重复是渲染
    时的事。按页收的话，一份 80 页的手册会多出 160 个几乎相同的块，把正文挤出
    召回名单。

    ⚠ 跳过「同前一节」的：那几节的页眉就是上一节那一份，收了就是重复；没定义
    页眉的文档也走这一支，于是不会多出一堆空块。

    Args: document。
    """
    made: list[Block] = []
    for index, section in enumerate(document.sections, start=1):
        for label, part in (
            ("页眉", section.header),
            ("页脚", section.footer),
        ):
            if part.is_linked_to_previous:
                continue
            text = _part_text(list(part.paragraphs))
            if text:
                made.append(
                    Block(
                        kind="caption",
                        text=text,
                        locator=Locator(sheet=label, row=index),
                    )
                )
    return made


def _textbox_texts(document: DocxDocument) -> list[str]:
    """文档里所有文本框的文字，按出现序去重。

    ⚠ 必须去重：Word 把同一个文本框在 `mc:Choice` 与 `mc:Fallback` 里各存
    一份，照单全收会让每一句都出现两遍。

    ⚠ `xpath` 回的是 `Any`，所以在这个函数里一次收敛成字符串，不往外带：
    python-docx 没有文本框的公开面，这是唯一够得着它的路。

    Args: document。
    """
    seen: list[str] = []
    for box in document.element.xpath(".//w:txbxContent"):
        for para in box.iter(qn("w:p")):
            text = "".join(
                str(node.text or "") for node in para.iter(qn("w:t"))
            ).strip()
            if text and text not in seen:
                seen.append(text)
    return seen


def _textbox_blocks(document: DocxDocument, made_so_far: int) -> list[Block]:
    """文本框里的文字，收在正文之后。

    ⚠ 现场的 Word 模板常把限值与注意事项放在文本框里，而文本框不在段落清单
    里——不捞的话那些内容一个字都进不来。

    ⚠ 收在末尾且**不带标题路径**：文本框是浮动对象，python-docx 没有公开面能
    把它定位到正文的哪一段，硬猜一个路径会让引用指错地方。

    Args: document, made_so_far。
    """
    made: list[Block] = []
    for index, text in enumerate(_textbox_texts(document), start=1):
        if made_so_far + len(made) >= MAX_BLOCKS:
            break
        made.append(
            Block(
                kind="paragraph",
                text=text,
                locator=Locator(sheet="文本框", row=index),
            )
        )
    return made


@dataclass(frozen=True)
class DocxParser:
    """Word 文档：按文档序走段落与表格，另收页眉页脚与文本框。"""

    name: str = "docx"
    suffixes: tuple[str, ...] = _DOCX_SUFFIXES
    media_types: tuple[str, ...] = (
        "application/vnd.openxmlformats-officedocument"
        ".wordprocessingml.document",
    )

    def parse(self, raw: RawItem) -> ParsedDocument:
        """页眉页脚 → 正文（段落与表格按文档序）→ 文本框。

        Args: raw。
        """
        document = Document(BytesIO(raw.content))
        walk = _Walk()
        walk.made.extend(_section_blocks(document))
        for item in document.iter_inner_content():
            if len(walk.made) >= MAX_BLOCKS:
                break
            if isinstance(item, Table):
                _table_into(walk, item)
            else:
                _paragraph_into(walk, item)
        walk.made.extend(_textbox_blocks(document, len(walk.made)))
        made = walk.made[:MAX_BLOCKS]
        return ParsedDocument(
            title=raw.filename,
            blocks=tuple(made),
            is_truncated=len(made) >= MAX_BLOCKS,
        )
