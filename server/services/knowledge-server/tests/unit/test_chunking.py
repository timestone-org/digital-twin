"""三种切法。守的是「每一块都自足」与「ordinal 连续」两件事。"""

import pytest

from knowledge_server.apps.knowledge.services.chunking import (
    CHUNKERS,
    DEFAULT_CHUNKER,
    UnknownChunker,
    chunker_for,
    chunker_names,
    estimated,
)
from knowledge_server.apps.knowledge.services.chunking.rows import RowChunker
from knowledge_server.apps.knowledge.services.chunking.structural import (
    StructuralChunker,
)
from knowledge_server.apps.knowledge.services.chunking.window import (
    FixedWindowChunker,
)
from knowledge_server.apps.knowledge.services.parsing import (
    Block,
    Locator,
    ParsedDocument,
)


def _document(*blocks: Block) -> ParsedDocument:
    return ParsedDocument(title="t", blocks=blocks)


def _paragraph(text: str, *path: str) -> Block:
    return Block(kind="paragraph", text=text, locator=Locator(path=path))


def test_structural_folds_a_section_into_one_chunk() -> None:
    made = StructuralChunker().split(
        _document(
            _paragraph("甲", "一章", "1.1"),
            _paragraph("乙", "一章", "1.1"),
        )
    )
    assert len(made) == 1
    assert "甲" in made[0].text
    assert "乙" in made[0].text


def test_the_heading_path_is_folded_into_the_text() -> None:
    """⚠ 不拼的话，一块「出口温度不得高于 65 ℃」读不出它说的是哪台设备，
    而模型会拿它去回答另一台的问题。"""
    made = StructuralChunker().split(
        _document(_paragraph("出口温度不得高于 65 ℃", "1 号机", "冷却水"))
    )
    assert made[0].text.startswith("1 号机 > 冷却水")
    assert made[0].heading_path == "1 号机 > 冷却水"


def test_a_new_section_always_cuts() -> None:
    """⚠ 一块里混着两节的内容时，检索到它的人会把两节的规定当成同一节的。"""
    made = StructuralChunker().split(
        _document(_paragraph("甲", "一章"), _paragraph("乙", "二章"))
    )
    assert len(made) == 2
    assert made[0].heading_path == "一章"
    assert made[1].heading_path == "二章"


def test_a_heading_block_always_starts_a_new_chunk() -> None:
    made = StructuralChunker().split(
        _document(
            _paragraph("正文", "一章"),
            Block(kind="heading", text="二章", level=1),
        )
    )
    assert len(made) == 2


def test_a_long_section_is_cut_on_block_boundaries() -> None:
    """⚠ 绝不在句子中间下刀：定长切出来的块有一半从半句话开始，
    而那半句话在向量空间里几乎没有区分度。"""
    long = "字" * 2_500
    made = StructuralChunker().split(
        _document(_paragraph(long, "一章"), _paragraph("尾巴", "一章"))
    )
    assert len(made) == 2
    assert made[1].text.endswith("尾巴")


def test_ordinals_are_dense_and_start_at_zero() -> None:
    """⚠ 它是 `(document_id, ordinal)` 那条唯一键的一半，跳号会让「第 5 块」
    在重新解析之后指向另一段文字。"""
    made = StructuralChunker().split(
        _document(
            _paragraph("甲", "一"),
            _paragraph("乙", "二"),
            _paragraph("丙", "三"),
        )
    )
    assert [one.ordinal for one in made] == [0, 1, 2]


def test_an_empty_document_yields_nothing() -> None:
    assert StructuralChunker().split(_document()) == ()
    assert FixedWindowChunker().split(_document()) == ()
    assert RowChunker().split(_document()) == ()


def test_window_cuts_by_length_with_overlap() -> None:
    made = FixedWindowChunker(max_chars=10, overlap=3).split(
        _document(_paragraph("字" * 25))
    )
    assert len(made) >= 3
    assert all(len(one.text) <= 10 for one in made)


def test_window_never_spins_when_overlap_swallows_the_window() -> None:
    """⚠ `overlap >= max_chars` 会让步长变成 0，原地打转切出无穷多块——
    那是一次内存耗尽而不是一条错误。"""
    made = FixedWindowChunker(max_chars=5, overlap=99).split(
        _document(_paragraph("字" * 20))
    )
    assert 0 < len(made) <= 20


def test_rows_keeps_one_block_per_chunk() -> None:
    """表格的每一行本来就是一条独立记录，攒几行进一块会让检索命中整片
    而指不出是哪一条。"""
    made = RowChunker().split(
        _document(
            Block(kind="table_row", text="甲=1", locator=Locator(row=1)),
            Block(kind="table_row", text="乙=2", locator=Locator(row=2)),
        )
    )
    assert len(made) == 2
    assert made[1].locator.row == 2


def test_rows_drops_blank_blocks() -> None:
    made = RowChunker().split(
        _document(_paragraph("甲"), _paragraph("   "), _paragraph("乙"))
    )
    assert [one.ordinal for one in made] == [0, 1]


def test_the_default_chunker_is_structural() -> None:
    """⚠ 结构切是默认，定长切留着是当对照组，不是当默认。"""
    assert chunker_for("").name == DEFAULT_CHUNKER
    assert DEFAULT_CHUNKER == "structural"


def test_an_unknown_chunker_raises_instead_of_falling_back() -> None:
    """⚠ 退回默认的表现是「库上配的切法一直没生效」，而配置面看着一切正常。"""
    with pytest.raises(UnknownChunker, match="没有叫 乱写的"):
        chunker_for("乱写的")


def test_registered_chunkers_have_distinct_names() -> None:
    names = chunker_names()
    assert len(names) == len(set(names))
    assert len(names) == len(CHUNKERS)


@pytest.mark.parametrize(
    ("text", "low", "high"),
    [("温度", 2, 2), ("temperature", 2, 4), ("", 0, 0)],
)
def test_token_estimate_counts_chinese_and_latin_apart(
    text: str, low: int, high: int
) -> None:
    """⚠ 混着按字符数除以四的话，中文文档会被低估四倍——而低估的表现是
    一次嵌入请求超限失败，且失败的是整批不是那一段。"""
    assert low <= estimated(text) <= high
