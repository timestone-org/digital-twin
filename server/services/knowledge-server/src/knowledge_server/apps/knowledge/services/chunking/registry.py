"""装了哪几种切法，以及按名字挑其中一种。

⚠ 注册是**显式元组**，不靠 import 副作用（ADR-0029 决策四）。

⚠ 认不出的名字**当场抛**，不退回默认：退回默认的表现是「库上配的切法一直
没生效」，而配置面看着一切正常。
"""

from knowledge_server.apps.knowledge.services.chunking.ports import Chunker
from knowledge_server.apps.knowledge.services.chunking.rows import RowChunker
from knowledge_server.apps.knowledge.services.chunking.structural import (
    StructuralChunker,
)
from knowledge_server.apps.knowledge.services.chunking.window import (
    FixedWindowChunker,
)

# 装了哪几种。⚠ 顺序即优先级，第一路是没配时的默认
CHUNKERS: tuple[Chunker, ...] = (
    StructuralChunker(),
    RowChunker(),
    FixedWindowChunker(),
)

# 没配时用哪一种。⚠ 结构切是默认，因为它切出来的块每一块都是完整意思单元；
# 定长切留着是当对照组，不是当默认
DEFAULT_CHUNKER = "structural"


class UnknownChunker(LookupError):
    """注册表里没有这个切法名。"""


def chunker_names(
    chunkers: tuple[Chunker, ...] = CHUNKERS,
) -> tuple[str, ...]:
    """装了哪几种，按注册序。

    Args: chunkers。
    """
    return tuple(one.name for one in chunkers)


def chunker_for(name: str, chunkers: tuple[Chunker, ...] = CHUNKERS) -> Chunker:
    """按名字挑一种；认不出就抛。

    Args: name（空串即默认那一种）, chunkers。
    """
    wanted = name or DEFAULT_CHUNKER
    for one in chunkers:
        if one.name == wanted:
            return one
    raise UnknownChunker(
        f"没有叫 {wanted} 的切法。这套部署装了："
        f"{'、'.join(chunker_names(chunkers))}"
    )
