"""装了哪几路解析器，以及按原件挑其中一路。

⚠ 注册是**显式元组**，不靠 import 副作用（ADR-0029 决策四）：隐式注册让
「装了哪些解析器」取决于 import 顺序，而顺序在测试里与生产里可以不同。

⚠ **界面的 accept 名单由这里算出来下发**，前端不再写死一份。两份漂开的表现是
「选得中的文件传上去被拒」——而两边单看都对，谁也不觉得自己错了。

⚠ 一期没有 PDF。加它就是加一个 `pdf.py` + 这里一行 + 一条契约测试，
不动任何调用方（ADR-0033 决策四）。在那之前传 PDF 的人拿到的是一句点得出
名字的错，**不是**一个状态 ready 却检索不到的空文档。
"""

from knowledge_server.apps.knowledge.services.parsing.office import (
    PptxParser,
    XlsxParser,
)
from knowledge_server.apps.knowledge.services.parsing.ports import (
    DocumentParser,
    ParsedDocument,
    RawItem,
    UnsupportedRawItem,
)
from knowledge_server.apps.knowledge.services.parsing.text import TextParser
from knowledge_server.apps.knowledge.services.parsing.word import DocxParser

# 装了哪几路。⚠ 加一路 = 加一个文件 + 这里一行 + 一条契约测试
PARSERS: tuple[DocumentParser, ...] = (
    TextParser(),
    DocxParser(),
    XlsxParser(),
    PptxParser(),
)


def accepted_suffixes(
    parsers: tuple[DocumentParser, ...] = PARSERS,
) -> tuple[str, ...]:
    """界面 file input 的 accept 名单，按注册序摊平。

    Args: parsers（只给测试换一份假的用）。
    """
    return tuple(one for parser in parsers for one in parser.suffixes)


def parser_for(
    raw: RawItem, parsers: tuple[DocumentParser, ...] = PARSERS
) -> DocumentParser:
    """按后缀挑一路；一路都不认就抛。

    ⚠ 先按**后缀**再按 media type：现场从别人系统拉回来的条目常常带一个
    `application/octet-stream`，而文件名是对的。反过来先信 media type 的话，
    那一批全都解不了。

    ⚠ 先到先得，按注册序。名单重叠时靠顺序定，而不是靠「最长后缀优先」这类
    隐式规则——那种规则在加第五路时没人记得。

    Args: raw, parsers。
    """
    lowered = raw.filename.lower()
    for parser in parsers:
        if lowered.endswith(parser.suffixes):
            return parser
    for parser in parsers:
        if raw.media_type in parser.media_types:
            return parser
    raise UnsupportedRawItem(
        f"认不出 {raw.filename} 是什么格式。这套部署收："
        f"{'、'.join(accepted_suffixes(parsers))}"
    )


def parse(
    raw: RawItem, parsers: tuple[DocumentParser, ...] = PARSERS
) -> ParsedDocument:
    """挑一路解析器把它解开。

    ⚠ **阻塞且吃 CPU**。调用方必须把它扔进进程池。

    Args: raw, parsers。
    """
    return parser_for(raw, parsers).parse(raw)
