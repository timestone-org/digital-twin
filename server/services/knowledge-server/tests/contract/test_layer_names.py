"""跨层的名字契约：数据库约束、注册名、能力面报的那几个字符串必须同源。

⚠ 这几处各写一份是刻意的（一处是数据库约束、一处是类型、一处是出参），
但它们**漂开的时候没有任何一处会报错**：库里写得下 'hybrid'，而注册表里
叫 'Hybrid' 的话，读出来的那一行永远选不到实现。这条用例就是那道闸。
"""

from knowledge_server.apps.knowledge.models.document import STATUSES
from knowledge_server.apps.knowledge.models.knowledge_base import STRATEGIES
from knowledge_server.apps.knowledge.models.source import KINDS
from knowledge_server.apps.knowledge.services.capability import (
    KEYWORD_FALLBACK,
    KEYWORD_FAST,
    VECTOR_FALLBACK,
    VECTOR_FAST,
)

# 迁移里那几条 CHECK 的字面量，逐字抄过来
MIGRATION_STRATEGIES = ("naive", "hybrid", "agentic")
MIGRATION_KINDS = ("upload", "platform")
MIGRATION_STATUSES = (
    "pending",
    "parsing",
    "chunking",
    "embedding",
    "indexing",
    "ready",
    "failed",
)


def test_strategy_names_match_the_check_constraint() -> None:
    assert STRATEGIES == MIGRATION_STRATEGIES


def test_source_kinds_match_the_check_constraint() -> None:
    assert KINDS == MIGRATION_KINDS


def test_document_statuses_match_the_check_constraint() -> None:
    assert STATUSES == MIGRATION_STATUSES


def test_index_lane_names_are_distinct() -> None:
    names = (VECTOR_FAST, VECTOR_FALLBACK, KEYWORD_FAST, KEYWORD_FALLBACK)
    assert len(set(names)) == len(names)
