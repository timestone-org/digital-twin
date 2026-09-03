"""纯文本族里 markdown 以外的三路：逐行纯文本、html、json。

markdown 那一路在 `test_parsing_markdown.py`。
"""

from knowledge_server.apps.knowledge.services.parsing import RawItem
from knowledge_server.apps.knowledge.services.parsing.text import (
    MAX_BLOCKS,
    TextParser,
)


def _raw(name: str, body: str) -> RawItem:
    return RawItem(
        filename=name, media_type="text/plain", content=body.encode("utf-8")
    )


def test_blank_lines_never_become_blocks() -> None:
    made = TextParser().parse(_raw("a.txt", "甲\n\n\n乙\n"))
    assert [one.text for one in made.blocks] == ["甲", "乙"]


def test_a_nameless_item_falls_back_to_plain_text() -> None:
    """⚠ 靠 media type 选中的条目常常没有像样的文件名（外部系统拉回来的那一
    批）。按 markdown 读它们会凭空造出标题层级。"""
    made = TextParser().parse(_raw("没有后缀", "# 甲\n乙\n"))
    assert [one.kind for one in made.blocks] == ["paragraph", "paragraph"]


def test_html_script_and_style_are_dropped() -> None:
    """⚠ 收进来的话，一段 minified js 会占满整个块，而它读起来像乱码；
    更要紧的是我们不该把别人系统里的脚本当正文对待。"""
    made = TextParser().parse(
        _raw(
            "a.html",
            "<h1>标题</h1><script>alert(1)</script>"
            "<style>p{color:red}</style><p>正文</p>",
        )
    )
    texts = [one.text for one in made.blocks]
    assert texts == ["标题", "正文"]


def test_html_headings_become_a_path() -> None:
    made = TextParser().parse(
        _raw("a.html", "<h1>一</h1><h2>1.1</h2><p>正文</p>")
    )
    assert made.blocks[-1].locator.path == ("一", "1.1")


def test_json_is_flattened_into_path_equals_value() -> None:
    made = TextParser().parse(
        _raw("a.json", '{"unit": {"name": "1号机", "limit": 65}}')
    )
    texts = sorted(one.text for one in made.blocks)
    assert texts == ["unit.limit = 65", "unit.name = 1号机"]


def test_json_arrays_are_indexed() -> None:
    made = TextParser().parse(_raw("a.json", '{"rows": ["甲", "乙"]}'))
    assert [one.text for one in made.blocks] == [
        "rows.0 = 甲",
        "rows.1 = 乙",
    ]


def test_broken_json_falls_back_to_plain_text() -> None:
    """⚠ 解不动就当纯文本，不抛：一份后缀写错的文本仍然值得摄取。"""
    made = TextParser().parse(_raw("a.json", "这不是 json"))
    assert made.blocks[0].text == "这不是 json"


def test_undecodable_bytes_never_fail_the_document() -> None:
    """⚠ 现场的文本文件常带一两个非法字节，为一个字符让整份文档摄取失败
    不值得。"""
    made = TextParser().parse(
        RawItem(
            filename="a.txt",
            media_type="text/plain",
            content=b"\xff\xfe" + "甲".encode(),
        )
    )
    assert made.blocks


def test_truncation_is_reported() -> None:
    """⚠ 悄悄截断的话，后面会把「我看到的就是全部」当成事实，然后下
    「这份文档里没有这一节」这种结论。"""
    made = TextParser().parse(_raw("a.txt", "行\n" * (MAX_BLOCKS + 10)))
    assert made.is_truncated is True
    assert len(made.blocks) == MAX_BLOCKS
