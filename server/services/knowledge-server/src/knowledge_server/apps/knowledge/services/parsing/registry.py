"""装了哪几路解析后端，以及按原件挑其中一路。

两条名单（ADR-0043）：`PARSERS` 是本地库解那一路，`EXTERNAL_BACKENDS` 是外部
解析服务那一路。⚠ 注册都是**显式元组**，不靠 import 副作用（ADR-0029 决策
四）：隐式注册让「装了哪些」取决于 import 顺序，而顺序在测试里与生产里可以
不同。

⚠ **界面的 accept 名单由这里算出来下发**，前端不再写死一份。两份漂开的表现是
「选得中的文件传上去被拒」——而两边单看都对，谁也不觉得自己错了。

⚠ 一期没有 PDF，也没有任何外部后端。加一路外部后端 = 加一个实现文件 +
`EXTERNAL_BACKENDS` 里一行 + 一条契约测试，不动任何调用方。在那之前传 PDF
的人拿到的是一句点得出名字的错，**不是**一个状态 ready 却检索不到的空文档。
"""

from knowledge_server.apps.knowledge.services.parsing.office import (
    PptxParser,
    XlsxParser,
)
from knowledge_server.apps.knowledge.services.parsing.ports import (
    DocumentParser,
    ExternalParserBackend,
    ParsedDocument,
    ParserBackend,
    RawItem,
    UnsupportedRawItem,
)
from knowledge_server.apps.knowledge.services.parsing.text import TextParser
from knowledge_server.apps.knowledge.services.parsing.word import DocxParser

# 本地库解那一路。⚠ 加一路 = 加一个文件 + 这里一行 + 一条契约测试
PARSERS: tuple[DocumentParser, ...] = (
    TextParser(),
    DocxParser(),
    XlsxParser(),
    PptxParser(),
)

# 外部解析服务那一路（MinerU / PP-Structure 这一类）。
# ⚠ 一期**空着就是诚实缺席**：没接的时候 `/capabilities` 如实说没接，而不是
# 摆一个调下去报奇怪错的占位。接进来要连着装配一起改，不能靠 import 副作用
EXTERNAL_BACKENDS: tuple[ExternalParserBackend, ...] = ()


def _accepts(backend: ParserBackend, raw: RawItem) -> bool:
    """这一路后端认这份原件的**后缀**吗。

    Args: backend, raw。
    """
    return raw.filename.lower().endswith(backend.suffixes)


def accepted_suffixes(
    parsers: tuple[DocumentParser, ...] = PARSERS,
    external: tuple[ExternalParserBackend, ...] = EXTERNAL_BACKENDS,
) -> tuple[str, ...]:
    """界面 file input 的 accept 名单，按注册序摊平并去重。

    ⚠ **两路都算进去**：接了一路能吃 PDF 的外部后端之后，界面必须当场收 PDF，
    否则那一路接了也用不上，而界面上看不出任何异常。

    Args: parsers, external。
    """
    seen: list[str] = []
    for backend in (*parsers, *external):
        seen.extend(one for one in backend.suffixes if one not in seen)
    return tuple(seen)


def external_for(
    raw: RawItem,
    external: tuple[ExternalParserBackend, ...] = EXTERNAL_BACKENDS,
) -> ExternalParserBackend | None:
    """外部那一路认不认这份原件；没接或都不认就给 `None`。

    ⚠ 外部后端**排在本地之前**：接一路外部解析服务的动机就是让它接管它更擅长
    的那几种格式，接了却不生效等于白接。一期这里恒给 `None`，于是整条链路与
    今天逐字相同。

    ⚠ 先按**后缀**再按 media type，与本地那一路同一条规矩。

    Args: raw, external。
    """
    for backend in external:
        if _accepts(backend, raw):
            return backend
    for backend in external:
        if raw.media_type in backend.media_types:
            return backend
    return None


def parser_for(
    raw: RawItem, parsers: tuple[DocumentParser, ...] = PARSERS
) -> DocumentParser:
    """本地那一路按后缀挑一个；一路都不认就抛。

    ⚠ 先按**后缀**再按 media type：现场从别人系统拉回来的条目常常带一个
    `application/octet-stream`，而文件名是对的。反过来先信 media type 的话，
    那一批全都解不了。

    ⚠ 先到先得，按注册序。名单重叠时靠顺序定，而不是靠「最长后缀优先」这类
    隐式规则——那种规则在加第五路时没人记得。

    Args: raw, parsers。
    """
    for parser in parsers:
        if _accepts(parser, raw):
            return parser
    for parser in parsers:
        if raw.media_type in parser.media_types:
            return parser
    raise UnsupportedRawItem(
        f"认不出 {raw.filename} 是什么格式。这套部署收："
        f"{'、'.join(accepted_suffixes(parsers))}"
    )


def parse_local(
    raw: RawItem, parsers: tuple[DocumentParser, ...] = PARSERS
) -> ParsedDocument:
    """挑一路**本地**解析器把它解开。

    ⚠ **阻塞且吃 CPU**，而且必须是模块级函数：调用方要把它扔进进程池，
    而进程池只传得动 picklable 的东西。

    ⚠ 刻意不认外部后端：外部那一路是异步网络 IO，进不了进程池，选它的判据在
    `external_for`。

    Args: raw, parsers。
    """
    return parser_for(raw, parsers).parse(raw)
