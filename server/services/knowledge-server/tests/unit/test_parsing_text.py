"""纯文本族的解析：标题层级要如实解出来，html 里的脚本要剥掉。"""

from knowledge_server.apps.knowledge.services.parsing import RawItem
from knowledge_server.apps.knowledge.services.parsing.text import (
    MAX_BLOCKS,
    TextParser,
)


def _raw(name: str, body: str) -> RawItem:
    return RawItem(
        filename=name, media_type="text/plain", content=body.encode("utf-8")
    )


def test_markdown_headings_build_a_path() -> None:
    """⚠ 标题层级是切块质量的主要来源：按标题切出来的块每一块都是完整的意思
    单元，按定长切出来的块有一半从句子中间开始。"""
    made = TextParser().parse(
        _raw("手册.md", "# 第一章\n## 1.1 冷却水\n出口温度不得高于 65 ℃\n")
    )
    body = made.blocks[-1]
    assert body.text == "出口温度不得高于 65 ℃"
    assert body.locator.path == ("第一章", "1.1 冷却水")


def test_a_sibling_heading_pops_the_stack() -> None:
    """⚠ 不弹栈的话「第二章」会挂在「第一章」下面，而那条错路径会一路带进
    每一个块的引用里。"""
    made = TextParser().parse(
        _raw("手册.md", "# 第一章\n## 1.1 甲\n## 1.2 乙\n正文\n")
    )
    assert made.blocks[-1].locator.path == ("第一章", "1.2 乙")


def test_a_shallower_heading_pops_everything_below() -> None:
    made = TextParser().parse(
        _raw("手册.md", "# 一\n## 1.1\n### 1.1.1\n# 二\n正文\n")
    )
    assert made.blocks[-1].locator.path == ("二",)


def test_list_items_keep_their_own_kind() -> None:
    made = TextParser().parse(_raw("a.md", "- 甲\n1. 乙\n普通段落\n"))
    kinds = [one.kind for one in made.blocks]
    assert kinds == ["list_item", "list_item", "paragraph"]
    assert made.blocks[0].text == "甲"


def test_blank_lines_never_become_blocks() -> None:
    made = TextParser().parse(_raw("a.txt", "甲\n\n\n乙\n"))
    assert [one.text for one in made.blocks] == ["甲", "乙"]


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
