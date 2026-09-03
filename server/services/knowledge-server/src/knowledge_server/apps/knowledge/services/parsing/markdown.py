"""markdown 那一路：走 CommonMark 规范实现（markdown-it-py），不自己扫行。

⚠ 自己按行扫会在两处**静默**出错：围栏代码块里的 `#` 被当成标题，setext
标题（下划线式）被当成正文。两者都只表现为「这一节怎么搜不到」。

⚠ `.txt` / `.log` 不走这里，分流在 `text.py`：日志里的 `# 注意` 不是标题。
"""

from dataclasses import dataclass, field

from markdown_it import MarkdownIt
from markdown_it.token import Token
from mdit_py_plugins.front_matter import front_matter_plugin

from knowledge_server.apps.knowledge.services.parsing.ports import (
    Block,
    BlockKind,
    Locator,
)
from knowledge_server.apps.knowledge.services.parsing.structure import (
    paired,
    path_of,
    pushed,
)

# `heading_open` 的 tag 是 `h1`–`h6`，层级在第二个字符起
_TAG_LEVEL_AT = 1
# 一个 open/inline/close 三连占几个 token
_TITLED_SPAN = 3


def _reader() -> MarkdownIt:
    """一份读法：CommonMark + 表格 + YAML front-matter。

    ⚠ 每次现造而不是模块级存一份：模块级可变状态在多副本与用例之间会互相
    污染，而造一份的开销只有一次解析的零头。

    ⚠ front-matter 必须由解析器认得，自己剥剥不干净：第一行 `---` 在
    CommonMark 里是主题分隔线，第二行紧跟着的 `---` 又把中间那行变成 setext
    二级标题——于是元数据变成了正文里的一个标题。
    """
    return MarkdownIt("commonmark").enable("table").use(front_matter_plugin)


def _inline_text(token: Token) -> str:
    """一个行内 token 的纯文本；markdown 记号一律不进正文。

    ⚠ 粗体的 `**`、链接的 `[](…)`、行内代码的反引号都不带进来：检索时
    `**温度**` 与 `温度` 不该是两个词。

    ⚠ 图片取 `content`（即 alt 文本）且**不下钻它的子节点**：alt 在两处各
    存了一份，下钻会把它数两遍。

    Args: token。
    """
    parts: list[str] = []
    for child in token.children or ():
        if child.type in ("text", "code_inline", "image"):
            parts.append(child.content)
        elif child.type in ("softbreak", "hardbreak"):
            parts.append(" ")
    return "".join(parts).strip()


@dataclass
class _Walk:
    """扫一遍 token 流时攒着的那几样。"""

    made: list[Block] = field(default_factory=list[Block])
    # 标题栈：层级 + 文本
    stack: list[tuple[int, str]] = field(default_factory=list[tuple[int, str]])
    # 当前套在几层列表项里；有序项存它的序号，无序项存空串
    items: list[str] = field(default_factory=list[str])
    # 已经摊过几张表，用来给 locator 编号
    tables: int = 0


def _emit(walk: _Walk, kind: BlockKind, text: str, level: int = 0) -> None:
    """收一个块，标题路径由当前栈决定。

    Args: walk, kind, text, level。
    """
    walk.made.append(
        Block(
            kind=kind,
            text=text,
            level=level,
            locator=Locator(path=path_of(walk.stack)),
        )
    )


def _numbered(walk: _Walk, text: str) -> str:
    """在有序列表里就把序号带上。

    ⚠ 序号是正文的一部分：工业手册里的「第 3 步」靠它才指得准，而 markdown
    把序号放在记号里，不带的话每一条都成了没有次序的句子。

    Args: walk, text。
    """
    number = walk.items[-1] if walk.items else ""
    return f"{number}. {text}" if number else text


def _titled(walk: _Walk, tokens: list[Token], index: int) -> int:
    """一个标题或段落：紧跟着的 inline 就是它的正文。

    Args: walk, tokens, index。
    """
    body = _inline_text(tokens[index + 1]) if index + 1 < len(tokens) else ""
    if not body:
        return index + _TITLED_SPAN
    if tokens[index].type == "heading_open":
        level = int(tokens[index].tag[_TAG_LEVEL_AT:] or 1)
        walk.stack = pushed(walk.stack, level, body)
        _emit(walk, "heading", body, level)
    elif walk.items:
        _emit(walk, "list_item", _numbered(walk, body), len(walk.items))
    else:
        _emit(walk, "paragraph", body)
    return index + _TITLED_SPAN


def _table_row(
    walk: _Walk, header: list[str], cells: list[str], row: int
) -> None:
    """一行表格成一块；表头那一行原样留，后面的行把表头折进去。

    Args: walk, header, cells, row。
    """
    walk.made.append(
        Block(
            kind="table_row",
            text=paired(header, cells) if header else " | ".join(cells),
            locator=Locator(
                sheet=f"表 {walk.tables}", row=row, path=path_of(walk.stack)
            ),
        )
    )


def _table(walk: _Walk, tokens: list[Token], index: int) -> int:
    """一张表摊成行块，回它闭合之后的位置。

    Args: walk, tokens, index。
    """
    walk.tables += 1
    header: list[str] = []
    cells: list[str] = []
    row = 0
    at = index + 1
    while at < len(tokens) and tokens[at].type != "table_close":
        if tokens[at].type == "inline":
            cells.append(_inline_text(tokens[at]))
        elif tokens[at].type == "tr_close":
            row += 1
            _table_row(walk, header, cells, row)
            header = header or cells
            cells = []
        at += 1
    return at + 1


def _step(walk: _Walk, tokens: list[Token], index: int) -> int:
    """处理一个 token，回下一个要看的位置。

    Args: walk, tokens, index。
    """
    kind = tokens[index].type
    if kind == "table_open":
        return _table(walk, tokens, index)
    if kind in ("heading_open", "paragraph_open"):
        return _titled(walk, tokens, index)
    if kind in ("fence", "code_block"):
        # ⚠ 整块成一块，不按行拆：拆开的话代码的上下文没了，而里面的 `#`
        # 与 `-` 会被后面每一层当成标题与列表
        _emit(walk, "paragraph", tokens[index].content.rstrip("\n"))
    elif kind == "list_item_open":
        walk.items.append(tokens[index].info)
    elif kind == "list_item_close" and walk.items:
        walk.items.pop()
    return index + 1


def markdown_blocks(text: str, limit: int) -> list[Block]:
    """一份 markdown 解成保结构的块序列。

    Args: text, limit（最多解出多少块）。
    """
    tokens = _reader().parse(text)
    walk = _Walk()
    index = 0
    while index < len(tokens) and len(walk.made) < limit:
        index = _step(walk, tokens, index)
    return walk.made[:limit]
