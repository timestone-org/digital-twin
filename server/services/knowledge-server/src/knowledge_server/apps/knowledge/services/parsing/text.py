"""纯文本那一路：md / txt / html / json。

⚠ 四种后缀在这里**按后缀分流**，不共用一种读法：markdown 走 CommonMark
（`markdown.py`），而 `.txt` / `.log` 走逐行读。把日志当 markdown 解的话，
一行 `# 注意` 会变成标题、`- 甲` 会变成列表项，于是整份日志被切成一棵假的
标题树；反过来（把 markdown 当纯文本）只是少了层级，代价小得多。

⚠ html **只剥标签取文本，绝不执行任何脚本**，也不跟外链。解析一份从别人系统
拉回来的 html 时，那里面可以有任何东西。
"""

import json
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import cast

from knowledge_server.apps.knowledge.services.parsing.markdown import (
    markdown_blocks,
)
from knowledge_server.apps.knowledge.services.parsing.ports import (
    Block,
    Locator,
    ParsedDocument,
    RawItem,
)
from knowledge_server.apps.knowledge.services.parsing.structure import (
    path_of,
    pushed,
)

# `h1`–`h6` 这种标签名的长度
_HEADING_TAG_LENGTH = 2
# 一份原件最多解出多少块。⚠ 有上限：一份几十万行的日志会把内存与后面每一层
# 一起拖垮，而它只表现为「这份文档传上去之后就没动静了」
MAX_BLOCKS = 20_000
# JSON 里一条路径最深展开到第几层
MAX_JSON_DEPTH = 8

_MARKDOWN_SUFFIXES = (".md", ".markdown")
_PLAIN_SUFFIXES = (".txt", ".text", ".log")
_HTML_SUFFIXES = (".html", ".htm")
_JSON_SUFFIXES = (".json",)


def _is_heading_tag(tag: str) -> bool:
    """`h1`–`h6` 才算标题标签。

    Args: tag。
    """
    return (
        len(tag) == _HEADING_TAG_LENGTH and tag[0] == "h" and tag[1].isdigit()
    )


class _TextOnly(HTMLParser):
    """只收文本与标题层级，别的一律丢掉。"""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[tuple[int, str]] = []
        self._level = 0
        self._skipping = False

    def handle_starttag(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],  # noqa: ARG002
    ) -> None:
        """开标签。⚠ 属性一个都不看：href 与 src 是外链，跟过去就等于让一份
        别人系统里的 html 决定我们去打哪个地址。

        Args: tag, attrs（协议要求的形参，本实现刻意不看）。
        """
        # ⚠ script 与 style 里的内容是代码不是正文：收进来的话，一段
        # minified js 会占满整个块，而它读起来像乱码
        if tag in ("script", "style"):
            self._skipping = True
        if _is_heading_tag(tag):
            self._level = int(tag[1])

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style"):
            self._skipping = False
        if _is_heading_tag(tag):
            self._level = 0

    def handle_data(self, data: str) -> None:
        text = data.strip()
        if text and not self._skipping:
            self.rows.append((self._level, text))


def _decoded(raw: RawItem) -> str:
    """把字节按 utf-8 读出来，读不动的字符原样替换掉。

    ⚠ 用 `replace` 而不是抛：现场的文本文件常带一两个非法字节（从别的编码
    转过来的残留），为一个字符让整份文档摄取失败不值得。

    Args: raw。
    """
    return raw.content.decode("utf-8", "replace")


def _plain_blocks(text: str) -> list[Block]:
    """逐行读的纯文本：一行一块，任何记号都不当记号。

    ⚠ 这一路刻意**不认标题与列表**：日志与说明文本里的 `#` 与 `-` 是内容，
    不是结构；认了的话一份日志会被切成一棵假的标题树，而那棵树会一路带进
    每一条引用。

    Args: text。
    """
    made: list[Block] = []
    for line in text.splitlines():
        if len(made) >= MAX_BLOCKS:
            break
        body = line.strip()
        if body:
            made.append(Block(kind="paragraph", text=body))
    return made


def _html_blocks(text: str) -> list[Block]:
    """剥掉标签只留文本，`h1`–`h6` 当标题。

    Args: text。
    """
    reader = _TextOnly()
    reader.feed(text)
    stack: list[tuple[int, str]] = []
    made: list[Block] = []
    for level, body in reader.rows[:MAX_BLOCKS]:
        if level > 0:
            stack = pushed(stack, level, body)
        made.append(
            Block(
                kind="heading" if level > 0 else "paragraph",
                text=body,
                level=level,
                locator=Locator(path=path_of(stack)),
            )
        )
    return made


def _json_rows(node: object, path: tuple[str, ...], out: list[Block]) -> None:
    """把一棵 JSON 摊成「路径 = 值」的行。

    ⚠ 深度有上限：一份自引用或者极深的结构会把栈用光，而那是一次进程崩溃
    而不是一条错误。

    Args: node, path, out。
    """
    if len(out) >= MAX_BLOCKS or len(path) > MAX_JSON_DEPTH:
        return
    if isinstance(node, dict):
        # ⚠ 收窄一次而不是原样遍历：`isinstance` 从 `object` narrow 出来的是
        # `dict[Unknown, Unknown]`，直接用会把未知类型一路带下去
        for key, value in cast("dict[object, object]", node).items():
            _json_rows(value, (*path, str(key)), out)
        return
    if isinstance(node, list):
        for index, value in enumerate(cast("list[object]", node)):
            _json_rows(value, (*path, str(index)), out)
        return
    out.append(
        Block(
            kind="paragraph",
            text=f"{'.'.join(path)} = {node}",
            locator=Locator(path=path),
        )
    )


def _json_blocks(text: str) -> list[Block]:
    """一份 JSON 摊成行；解不动就按纯文本逐行读。

    ⚠ 解不动就退纯文本而不是抛：一份后缀写错的文本仍然值得摄取。退的是
    **纯文本**不是 markdown——一份不是 json 的东西更不会是 markdown。

    Args: text。
    """
    try:
        tree: object = json.loads(text)
    except ValueError:
        return _plain_blocks(text)
    made: list[Block] = []
    _json_rows(tree, (), made)
    return made


def _blocks_for(filename: str, text: str) -> list[Block]:
    """按后缀挑一种读法。

    ⚠ 认不出后缀时按**纯文本**读，不按 markdown：走到这里的一定是靠 media
    type 选中的条目（外部系统拉回来的常常没有像样的文件名），而它们多半就是
    纯文本。

    Args: filename, text。
    """
    lowered = filename.lower()
    if lowered.endswith(_HTML_SUFFIXES):
        return _html_blocks(text)
    if lowered.endswith(_JSON_SUFFIXES):
        return _json_blocks(text)
    if lowered.endswith(_MARKDOWN_SUFFIXES):
        return markdown_blocks(text, MAX_BLOCKS)
    return _plain_blocks(text)


@dataclass(frozen=True)
class TextParser:
    """纯文本族的解析器。"""

    name: str = "text"
    suffixes: tuple[str, ...] = (
        *_MARKDOWN_SUFFIXES,
        *_PLAIN_SUFFIXES,
        *_HTML_SUFFIXES,
        *_JSON_SUFFIXES,
    )
    media_types: tuple[str, ...] = (
        "text/plain",
        "text/markdown",
        "text/html",
        "application/json",
    )

    def parse(self, raw: RawItem) -> ParsedDocument:
        """按后缀挑一种读法，产出保结构的块序列。

        Args: raw。
        """
        made = _blocks_for(raw.filename, _decoded(raw))
        return ParsedDocument(
            title=raw.filename,
            blocks=tuple(made),
            is_truncated=len(made) >= MAX_BLOCKS,
        )
