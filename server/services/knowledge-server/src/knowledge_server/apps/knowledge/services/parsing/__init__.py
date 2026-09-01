"""层 2 解析：一份原件解成保结构的块序列。"""

from knowledge_server.apps.knowledge.services.parsing.ports import (
    BLOCK_KINDS,
    Block,
    BlockKind,
    DocumentParser,
    Locator,
    ParsedDocument,
    RawItem,
    UnsupportedRawItem,
)
from knowledge_server.apps.knowledge.services.parsing.registry import (
    PARSERS,
    accepted_suffixes,
    parse,
    parser_for,
)

__all__ = [
    "BLOCK_KINDS",
    "PARSERS",
    "Block",
    "BlockKind",
    "DocumentParser",
    "Locator",
    "ParsedDocument",
    "RawItem",
    "UnsupportedRawItem",
    "accepted_suffixes",
    "parse",
    "parser_for",
]
