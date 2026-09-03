"""markdown 解析：走 CommonMark 规范实现，记号不进正文、代码块不被拆开。

⚠ 这一组里有好几条是**手写正则必红**的：围栏代码块里的 `#`、setext 标题、
front-matter、表格。它们各自都只表现为「这一节怎么搜不到」，没有任何一处报错。
"""

from knowledge_server.apps.knowledge.services.parsing import RawItem
from knowledge_server.apps.knowledge.services.parsing.markdown import (
    markdown_blocks,
)
from knowledge_server.apps.knowledge.services.parsing.text import (
    MAX_BLOCKS,
    TextParser,
)


def _blocks(body: str) -> list[tuple[str, str]]:
    """(kind, text) 的序列，断言起来比整个 Block 好读。"""
    return [(one.kind, one.text) for one in markdown_blocks(body, MAX_BLOCKS)]


def _parsed(name: str, body: str) -> list[tuple[str, str]]:
    made = TextParser().parse(
        RawItem(
            filename=name, media_type="text/plain", content=body.encode("utf-8")
        )
    )
    return [(one.kind, one.text) for one in made.blocks]


def test_atx_headings_build_a_path() -> None:
    """⚠ 标题层级是切块质量的主要来源：按标题切出来的块每一块都是完整的意思
    单元，按定长切出来的块有一半从句子中间开始。"""
    made = markdown_blocks(
        "# 第一章\n\n## 1.1 冷却水\n\n出口温度不得高于 65 ℃\n", MAX_BLOCKS
    )
    body = made[-1]
    assert body.text == "出口温度不得高于 65 ℃"
    assert body.locator.path == ("第一章", "1.1 冷却水")


def test_setext_headings_are_headings_too() -> None:
    """⚠ 下划线式标题按行扫的正则一律认不出，于是整节正文挂在上一节下面——
    而那条错路径会一路带进每一条引用。"""
    made = markdown_blocks(
        "第一章\n===\n\n1.1 冷却水\n---\n\n出口温度 65 ℃\n", MAX_BLOCKS
    )
    assert [(one.kind, one.level) for one in made[:2]] == [
        ("heading", 1),
        ("heading", 2),
    ]
    assert made[-1].locator.path == ("第一章", "1.1 冷却水")


def test_a_sibling_heading_pops_the_stack() -> None:
    made = markdown_blocks(
        "# 第一章\n\n## 1.1 甲\n\n## 1.2 乙\n\n正文\n", MAX_BLOCKS
    )
    assert made[-1].locator.path == ("第一章", "1.2 乙")


def test_a_shallower_heading_pops_everything_below() -> None:
    made = markdown_blocks(
        "# 一\n\n## 1.1\n\n### 1.1.1\n\n# 二\n\n正文\n", MAX_BLOCKS
    )
    assert made[-1].locator.path == ("二",)


def test_a_fenced_code_block_stays_one_block() -> None:
    """⚠ 按行扫的正则会把代码里的 `#` 当标题、把 `- x` 当列表项——于是一段
    脚本变成一棵假的标题树，而它下面的正文全挂错了地方。"""
    made = _blocks("# 真标题\n\n```python\n# 这不是标题\n- 也不是列表\n```\n")
    assert made == [
        ("heading", "真标题"),
        ("paragraph", "# 这不是标题\n- 也不是列表"),
    ]


def test_an_indented_code_block_stays_one_block() -> None:
    made = _blocks("正文\n\n    第一行\n    第二行\n")
    assert made[-1] == ("paragraph", "第一行\n第二行")


def test_inline_markup_never_reaches_the_text() -> None:
    """⚠ 检索时 `**温度**` 与 `温度` 不该是两个词。"""
    made = _blocks("看 **温度** 与 [手册](http://x/a) 里的 `set_point`。\n")
    assert made == [("paragraph", "看 温度 与 手册 里的 set_point。")]


def test_an_image_contributes_its_alt_text_once() -> None:
    """⚠ alt 在 token 里存了两份，下钻子节点会把它数两遍。"""
    assert _blocks("![温度曲线](a.png)\n") == [("paragraph", "温度曲线")]


def test_front_matter_never_becomes_content() -> None:
    """⚠ 自己剥剥不干净：第一行 `---` 是主题分隔线，第二个 `---` 又把中间那行
    变成 setext 二级标题——于是元数据成了正文里的一个标题。"""
    made = _blocks("---\ntitle: 手册\nowner: 运行部\n---\n\n# 第一章\n\n正文\n")
    assert made == [("heading", "第一章"), ("paragraph", "正文")]


def test_a_blockquote_keeps_its_text_without_the_marker() -> None:
    """⚠ `>` 留在正文里会跟着进分词，而它不是内容。"""
    assert _blocks("> 停机前先确认阀门关闭\n") == [
        ("paragraph", "停机前先确认阀门关闭")
    ]


def test_nested_list_items_report_their_depth() -> None:
    made = markdown_blocks("- 甲\n  - 甲一\n- 乙\n", MAX_BLOCKS)
    assert [(one.kind, one.text, one.level) for one in made] == [
        ("list_item", "甲", 1),
        ("list_item", "甲一", 2),
        ("list_item", "乙", 1),
    ]


def test_ordered_items_carry_their_number() -> None:
    """⚠ 工业手册里的「第 3 步」靠序号才指得准，而 markdown 把序号放在
    记号里。"""
    assert _blocks("1. 停泵\n2. 关阀\n3. 挂牌\n") == [
        ("list_item", "1. 停泵"),
        ("list_item", "2. 关阀"),
        ("list_item", "3. 挂牌"),
    ]


def test_a_table_folds_its_header_into_every_row() -> None:
    """⚠ 与工作簿那一路同一条规矩：只存 `65` 的话，检索到这一行也读不出它是
    什么——列名在表头那一行，而那一行是另一个块。"""
    made = markdown_blocks(
        "| 点位 | 上限 |\n| --- | --- |\n"
        "| 出口温度 | 65 |\n| 入口温度 | 40 |\n",
        MAX_BLOCKS,
    )
    assert [one.kind for one in made] == ["table_row"] * 3
    assert made[0].text == "点位 | 上限"
    assert made[1].text == "点位=出口温度 | 上限=65"
    assert (made[1].locator.sheet, made[1].locator.row) == ("表 1", 2)
    assert made[2].locator.row == 3


def test_a_table_inherits_the_heading_path() -> None:
    made = markdown_blocks(
        "# 一章\n\n| 列 |\n| --- |\n| 值 |\n",
        MAX_BLOCKS,
    )
    assert made[-1].locator.path == ("一章",)


def test_two_tables_get_distinct_locators() -> None:
    """⚠ 两张表都叫「表 1」的话，引用指到哪一张就说不清了。"""
    made = markdown_blocks(
        "| 甲 |\n| --- |\n| 一 |\n\n正文\n\n| 乙 |\n| --- |\n| 二 |\n",
        MAX_BLOCKS,
    )
    sheets = {one.locator.sheet for one in made if one.kind == "table_row"}
    assert sheets == {"表 1", "表 2"}


def test_html_inside_markdown_is_dropped_not_shown_raw() -> None:
    """⚠ 内嵌 html 的标签不该进正文；它不是内容。"""
    assert _blocks("正文 <span>与标签</span>\n") == [
        ("paragraph", "正文 与标签")
    ]


def test_a_markdown_file_goes_through_the_markdown_lane() -> None:
    assert _parsed("手册.md", "# 一章\n") == [("heading", "一章")]


def test_a_log_file_never_gets_markdown_structure() -> None:
    """⚠ 日志里的 `# 注意` 是内容不是标题，`- 甲` 是内容不是列表项。认了的话
    整份日志被切成一棵假的标题树，而那棵树会一路带进每一条引用。"""
    made = _parsed("run.log", "# 注意\n- 甲\n> 乙\n")
    assert made == [
        ("paragraph", "# 注意"),
        ("paragraph", "- 甲"),
        ("paragraph", "> 乙"),
    ]


def test_a_txt_file_never_gets_markdown_structure() -> None:
    made = TextParser().parse(
        RawItem(
            filename="说明.txt",
            media_type="text/plain",
            content="# 注意\n".encode(),
        )
    )
    assert [one.kind for one in made.blocks] == ["paragraph"]
    assert made.blocks[0].locator.path == ()


def test_markdown_truncation_is_reported() -> None:
    """⚠ 悄悄截断的话，后面会把「我看到的就是全部」当成事实。"""
    made = TextParser().parse(
        RawItem(
            filename="a.md",
            media_type="text/plain",
            content=("行\n\n" * (MAX_BLOCKS + 10)).encode(),
        )
    )
    assert made.is_truncated is True
    assert len(made.blocks) == MAX_BLOCKS


def test_a_soft_line_break_stays_inside_one_block() -> None:
    """⚠ 换行不是分段：拆成两块的话，跨行的一句话在向量空间里成了两个半句。"""
    assert _blocks("第一行\n第二行\n") == [("paragraph", "第一行 第二行")]


def test_an_empty_heading_never_becomes_a_block() -> None:
    """⚠ 空标题压进标题栈的话，后面每一块的引用路径里会多出一个空环节。"""
    made = markdown_blocks("#\n\n正文\n", MAX_BLOCKS)
    assert [(one.kind, one.text) for one in made] == [("paragraph", "正文")]
    assert made[0].locator.path == ()
