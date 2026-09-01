"""纯文本那一路：md / txt / html / json。

⚠ markdown 的标题层级是**切块质量的主要来源**：按标题切出来的块，每一块都是
一个完整的意思单元；按定长切出来的块，一半的块从句子中间开始。所以这一路要把
`#` 层级如实解出来，而不是当成普通行。

⚠ html **只剥标签取文本，绝不执行任何脚本**，也不跟外链。解析一份从别人系统
拉回来的 html 时，那里面可以有任何东西。
"""

import json
import re
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import cast

from knowledge_server.apps.knowledge.services.parsing.ports import (
    Block,
    Locator,
    ParsedDocument,
    RawItem,
)

# markdown 的 ATX 标题：井号数即层级
_HEADING = re.compile(r"^(#{1,6})\s+(.*\S)\s*$")
# 无序与有序列表项
_LIST_ITEM = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$")
# `h1`–`h6` 这种标签名的长度
_HEADING_TAG_LENGTH = 2
# 一份原件最多解出多少块。⚠ 有上限：一份几十万行的日志会把内存与后面每一层
# 一起拖垮，而它只表现为「这份文档传上去之后就没动静了」
MAX_BLOCKS = 20_000
# JSON 里一条路径最深展开到第几层
MAX_JSON_DEPTH = 8

_MARKDOWN_SUFFIXES = (".md", ".markdown", ".txt", ".text", ".log")
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


def _path_of(stack: list[tuple[int, str]]) -> tuple[str, ...]:
    """当前标题栈摊成一条路径。

    Args: stack。
    """
    return tuple(text for _level, text in stack)


def _pushed(
    stack: list[tuple[int, str]], level: int, text: str
) -> list[tuple[int, str]]:
    """把一个标题压进栈，先弹掉不比它浅的那几层。

    ⚠ 必须先弹：不弹的话「第 2 章」之后的「第 3 章」会挂在「第 2 章」下面，
    而那条路径会一路带进每一个块的引用里。

    Args: stack, level, text。
    """
    kept = [one for one in stack if one[0] < level]
    kept.append((level, text))
    return kept


def _markdown_blocks(text: str) -> list[Block]:
    """按行扫 markdown / 纯文本，标题层级如实解出来。

    Args: text。
    """
    stack: list[tuple[int, str]] = []
    made: list[Block] = []
    for line in text.splitlines():
        if len(made) >= MAX_BLOCKS:
            break
        heading = _HEADING.match(line)
        if heading is not None:
            level = len(heading.group(1))
            stack = _pushed(stack, level, heading.group(2))
            made.append(
                Block(
                    kind="heading",
                    text=heading.group(2),
                    level=level,
                    locator=Locator(path=_path_of(stack)),
                )
            )
            continue
        item = _LIST_ITEM.match(line)
        body = item.group(1) if item is not None else line.strip()
        if not body:
            continue
        made.append(
            Block(
                kind="list_item" if item is not None else "paragraph",
                text=body,
                locator=Locator(path=_path_of(stack)),
            )
        )
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
            stack = _pushed(stack, level, body)
        made.append(
            Block(
                kind="heading" if level > 0 else "paragraph",
                text=body,
                level=level,
                locator=Locator(path=_path_of(stack)),
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
    """一份 JSON 摊成行；解不动就当纯文本。

    Args: text。
    """
    try:
        tree: object = json.loads(text)
    except ValueError:
        return _markdown_blocks(text)
    made: list[Block] = []
    _json_rows(tree, (), made)
    return made


@dataclass(frozen=True)
class TextParser:
    """纯文本族的解析器。"""

    name: str = "text"
    suffixes: tuple[str, ...] = (
        *_MARKDOWN_SUFFIXES,
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
        text = _decoded(raw)
        lowered = raw.filename.lower()
        if lowered.endswith(_HTML_SUFFIXES):
            made = _html_blocks(text)
        elif lowered.endswith(_JSON_SUFFIXES):
            made = _json_blocks(text)
        else:
            made = _markdown_blocks(text)
        return ParsedDocument(
            title=raw.filename,
            blocks=tuple(made),
            is_truncated=len(made) >= MAX_BLOCKS,
        )
