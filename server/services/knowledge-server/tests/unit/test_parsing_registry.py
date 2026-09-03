"""按原件挑解析器：先看后缀，再看 media type，都认不出就当场抛。"""

import pytest

from knowledge_server.apps.knowledge.services.parsing import (
    PARSERS,
    Locator,
    ParsedDocument,
    RawItem,
    UnsupportedRawItem,
    accepted_suffixes,
    parse_local,
    parser_for,
)
from knowledge_server.apps.knowledge.services.parsing.text import TextParser


def _raw(name: str, media_type: str = "") -> RawItem:
    return RawItem(filename=name, media_type=media_type, content=b"body")


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("a.md", "text"),
        ("A.MD", "text"),
        ("a.json", "text"),
        ("a.docx", "docx"),
        ("a.xlsx", "xlsx"),
        ("a.xlsm", "xlsx"),
        ("a.pptx", "pptx"),
    ],
)
def test_the_suffix_picks_the_parser(name: str, expected: str) -> None:
    assert parser_for(_raw(name)).name == expected


def test_media_type_is_only_the_fallback() -> None:
    """⚠ 先按后缀：现场从别人系统拉回来的条目常带一个
    `application/octet-stream`，而文件名是对的。反过来先信 media type 的话，
    那一批全都解不了。"""
    docx_type = (
        "application/vnd.openxmlformats-officedocument"
        ".wordprocessingml.document"
    )
    assert parser_for(_raw("说明.md", docx_type)).name == "text"
    assert parser_for(_raw("没有后缀", docx_type)).name == "docx"


def test_an_unknown_format_raises_by_name() -> None:
    """⚠ 静默给空的表现是「传上去了、状态 ready、检索却查不到」——
    那与「这份文档里确实没这句话」长得一模一样。"""
    with pytest.raises(UnsupportedRawItem, match=r"图纸\.pdf"):
        parser_for(_raw("图纸.pdf"))


def test_the_error_lists_what_is_accepted() -> None:
    """认不出的时候要顺手告诉人这套部署收什么，否则只能去翻代码。"""
    with pytest.raises(UnsupportedRawItem, match=r"\.docx"):
        parser_for(_raw("a.pdf"))


def test_pdf_needs_an_external_backend_to_show_up() -> None:
    """⚠ 一期不收 PDF 是拍过板的。加它就是加一个文件 + 注册表一行，
    不动任何调用方——这条用例是那句话的凭证，改了要连着文档一起改。"""
    assert ".pdf" not in accepted_suffixes(())


def test_accepted_suffixes_has_no_duplicates() -> None:
    """⚠ 重了的话「先到先得」就成了实际规则，而那条规则没人记得。"""
    names = accepted_suffixes(())
    assert len(names) == len(set(names))


def test_every_suffix_is_lowercase_with_a_dot() -> None:
    """名单直接下发给界面当 accept，形状写歪一个就选不中那类文件。"""
    assert all(
        one.startswith(".") and one == one.lower()
        for one in accepted_suffixes(())
    )


def test_registry_order_decides_who_wins() -> None:
    """⚠ 靠注册序而不是「最长后缀优先」这类隐式规则——那种规则在加第五路时
    没人记得。"""

    greedy = TextParser(name="greedy")
    assert parser_for(_raw("a.md"), (greedy, TextParser())).name == "greedy"
    assert parser_for(_raw("a.md"), (TextParser(), greedy)).name == "text"


def test_parse_goes_through_the_same_dispatch() -> None:
    made = parse_local(
        RawItem(filename="a.md", media_type="", content=b"# title")
    )
    assert isinstance(made, ParsedDocument)
    assert made.blocks[0].kind == "heading"


def test_every_registered_parser_has_a_distinct_name() -> None:
    names = [one.name for one in PARSERS]
    assert len(names) == len(set(names))


@pytest.mark.parametrize(
    ("locator", "expected"),
    [
        (Locator(), ""),
        (Locator(page=12), "第 12 页"),
        (Locator(sheet="1月", row=3), "1月 · 第 3 行"),
        (Locator(path=("一章", "1.1")), "一章 > 1.1"),
        (
            Locator(sheet="表", page=2, row=5, path=("甲",)),
            "表 · 第 2 页 · 第 5 行 · 甲",
        ),
    ],
)
def test_the_locator_reads_as_one_human_sentence(
    locator: Locator, expected: str
) -> None:
    """⚠ 这句话会跟着每一条引用上界面：指不出出处的答案，用户没法核对，
    也就不敢用。"""
    assert locator.label() == expected
