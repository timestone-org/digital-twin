"""每个注册表都要有一条「注册的实现都满足 Protocol」。

⚠ 不钉这一条的话，注册表本身就成了新的静默失效点：一个少写了 `suffixes`
的解析器装得进去，只在真有人传那种文件时才炸——而那时报出来的是
`AttributeError`，与「这套部署不收这种格式」完全对不上号。
"""

from knowledge_server.apps.knowledge.services.chunking import (
    CHUNKERS,
    DEFAULT_CHUNKER,
    Chunker,
    chunker_names,
)
from knowledge_server.apps.knowledge.services.parsing import (
    BLOCK_KINDS,
    EXTERNAL_BACKENDS,
    PARSERS,
    DocumentParser,
    ExternalParserBackend,
    ParserBackend,
    accepted_suffixes,
)


def test_every_parser_satisfies_the_protocol() -> None:
    for one in PARSERS:
        assert isinstance(one, DocumentParser), one


def test_every_external_backend_satisfies_the_protocol() -> None:
    """⚠ 一期这条是空跑的，但它是接第一路外部后端时的第一道闸：少写一个
    `suffixes` 的后端装得进去，只在真有人传那种文件时才炸。"""
    for one in EXTERNAL_BACKENDS:
        assert isinstance(one, ExternalParserBackend), one


def test_both_lanes_satisfy_the_shared_backend_protocol() -> None:
    for one in (*PARSERS, *EXTERNAL_BACKENDS):
        assert isinstance(one, ParserBackend), one


def test_no_backend_name_is_used_twice_across_the_two_lanes() -> None:
    """⚠ 两路重名的话，`/capabilities` 报出来的那份名单指不清是哪一个，
    而运维照着名字去查日志会查到另一路。"""
    names = [one.name for one in (*PARSERS, *EXTERNAL_BACKENDS)]
    assert len(names) == len(set(names))


def test_every_chunker_satisfies_the_protocol() -> None:
    for one in CHUNKERS:
        assert isinstance(one, Chunker), one


def test_every_parser_declares_at_least_one_suffix() -> None:
    """认不出任何后缀的解析器永远不会被挑中——那是一段没人调的死代码，
    而它看起来像一路正常的实现。"""
    for one in PARSERS:
        assert one.suffixes, one.name


def test_every_parser_declares_at_least_one_media_type() -> None:
    """media type 是 `discover` 那一路唯一的判据：外部系统的条目常常没有
    像样的文件名。"""
    for one in PARSERS:
        assert one.media_types, one.name


def test_no_two_parsers_claim_the_same_suffix() -> None:
    """⚠ 重了的话「先到先得」就成了实际规则，而那条规则没人记得。"""
    seen: dict[str, str] = {}
    clashes: list[str] = []
    for parser in PARSERS:
        for suffix in parser.suffixes:
            if suffix in seen:
                clashes.append(f"{suffix}: {seen[suffix]} 与 {parser.name}")
            seen[suffix] = parser.name
    assert clashes == []


def test_the_default_chunker_is_actually_registered() -> None:
    """⚠ 默认名写歪一个字符的表现是「每一次摄取都抛」，而那句错说的是
    「没有叫 xxx 的切法」——与「我没改过配置」对不上号。"""
    assert DEFAULT_CHUNKER in chunker_names()


def test_block_kinds_stay_a_closed_set() -> None:
    """切块层按它决定在哪里下刀。加一种块类型要连着切块层一起改，
    不然新类型会被当成普通段落而丢掉层级信息。"""
    assert BLOCK_KINDS == (
        "heading",
        "paragraph",
        "table_row",
        "list_item",
        "caption",
    )


def test_the_accept_list_is_what_gets_sent_to_the_browser() -> None:
    """⚠ 前端不写死一份：两份漂开的表现是「选得中的文件传上去被拒」，
    而两边单看都对。"""
    assert set(accepted_suffixes()) == {
        one
        for backend in (*PARSERS, *EXTERNAL_BACKENDS)
        for one in backend.suffixes
    }
