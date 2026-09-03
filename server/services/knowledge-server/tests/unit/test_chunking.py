"""三种切法。守的是「每一块都装得进嵌入窗口」「不过度切分」与
「ordinal 连续」三件事。"""

import pytest

from knowledge_server.apps.knowledge.services.chunking import (
    CHUNKERS,
    DEFAULT_CHUNKER,
    Chunk,
    ChunkLimits,
    UnknownChunker,
    chunker_for,
    chunker_names,
    estimated,
    limits_for,
    oversized,
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

# 本部署那一档：窗口 512，折过安全系数是 460
LIMITS = limits_for(512, 80, 120)
# 小窗口，用来在几十字的样例上验边界
TINY = ChunkLimits(max_tokens=40, min_tokens=10, overlap_chars=8)


def _document(*blocks: Block) -> ParsedDocument:
    return ParsedDocument(title="t", blocks=blocks)


def _paragraph(text: str, *path: str) -> Block:
    return Block(kind="paragraph", text=text, locator=Locator(path=path))


def _sentences(count: int) -> str:
    return "".join(
        f"这是第{one}句话，说的是冷却水的事。" for one in range(count)
    )


def test_structural_folds_a_section_into_one_chunk() -> None:
    made = StructuralChunker().split(
        _document(
            _paragraph("甲", "一章", "1.1"),
            _paragraph("乙", "一章", "1.1"),
        ),
        LIMITS,
    )
    assert len(made) == 1
    assert "甲" in made[0].text
    assert "乙" in made[0].text


def test_the_heading_path_is_folded_into_the_text() -> None:
    """⚠ 不拼的话，一块「出口温度不得高于 65 ℃」读不出它说的是哪台设备，
    而模型会拿它去回答另一台的问题。"""
    made = StructuralChunker().split(
        _document(_paragraph("出口温度不得高于 65 ℃", "1 号机", "冷却水")),
        LIMITS,
    )
    assert made[0].text.startswith("1 号机 > 冷却水")
    assert made[0].heading_path == "1 号机 > 冷却水"


def test_every_chunk_fits_the_embedding_window() -> None:
    """⚠ 这一条是整层的立身之本：超窗的那一截被嵌入端点**静默丢掉**，
    文档照样走到 ready，而那一段从此对向量检索不存在。本部署实测过一份
    2031 字的块——它只有前 520 字进过向量。"""
    made = StructuralChunker().split(
        _document(
            _paragraph(_sentences(200), "一章", "1.1"),
            _paragraph(_sentences(200), "一章", "1.2"),
        ),
        LIMITS,
    )
    assert len(made) > 1
    assert all(estimated(one.text) <= LIMITS.max_tokens for one in made)


def test_an_oversized_block_is_cut_at_a_sentence_end() -> None:
    """⚠ 只在块边界下刀这条规矩对一个两千字的段落无能为力；断得开之后
    也要断在句读处——从半句话开始的块在向量空间里几乎没有区分度。"""
    made = StructuralChunker().split(
        _document(_paragraph(_sentences(40), "一章")), TINY
    )
    assert len(made) > 1
    assert all(one.text.rstrip().endswith("。") for one in made[:-1])


def test_two_tiny_sections_are_folded_instead_of_split_apart() -> None:
    """⚠ 换了标题就断的写法会切出只有一行标题的块，它又短又泛，与任何查询
    都有中等相似度，专挤名次。本部署那份 14 块的报告里有 3 块是 25/29/32 字
    的光秃秃标题行。"""
    made = StructuralChunker().split(
        _document(
            _paragraph("甲", "报告", "一"), _paragraph("乙", "报告", "二")
        ),
        LIMITS,
    )
    assert len(made) == 1
    assert "甲" in made[0].text
    assert "乙" in made[0].text


def test_a_folded_chunk_is_labelled_with_the_common_ancestor() -> None:
    """⚠ 取其中任一节的路径都会让引用指向另一节，而正文里明明有两节；
    取祖先只是说得粗一点，从不指错。"""
    made = StructuralChunker().split(
        _document(
            _paragraph("甲", "报告", "一"), _paragraph("乙", "报告", "二")
        ),
        LIMITS,
    )
    assert made[0].heading_path == "报告"
    assert made[0].locator.path == ("报告",)


def test_a_new_section_cuts_once_the_minimum_is_met() -> None:
    """⚠ 攒够了还不断的话，一块里会混着两节的内容，检索到它的人会把两节的
    规定当成同一节的。"""
    made = StructuralChunker().split(
        _document(
            _paragraph(_sentences(12), "一章"),
            _paragraph(_sentences(12), "二章"),
        ),
        LIMITS,
    )
    assert len(made) == 2
    assert made[0].heading_path == "一章"
    assert made[1].heading_path == "二章"


def test_a_heading_block_starts_a_new_chunk_once_the_minimum_is_met() -> None:
    made = StructuralChunker().split(
        _document(
            _paragraph(_sentences(12), "一章"),
            Block(kind="heading", text="二章", level=1),
        ),
        LIMITS,
    )
    assert len(made) == 2


def test_neighbouring_chunks_really_overlap() -> None:
    """⚠ 带「最后那一整块」的写法在尾块比重叠长时一个字都不带——于是重叠这件
    事在多数情况下根本没发生，而它看起来只是「这个问题模型不会」。"""
    made = StructuralChunker().split(
        _document(_paragraph(_sentences(40), "一章")), TINY
    )
    assert len(made) > 1
    tail = made[0].text[-TINY.overlap_chars :]
    assert any(one and one in made[1].text for one in (tail[-6:],))


def test_the_overlap_never_crosses_a_section() -> None:
    """⚠ 跨节带的话，下一节的开头会挂着上一节的结论，而那正是「引用指错
    地方」的来路。"""
    made = StructuralChunker().split(
        _document(
            _paragraph(_sentences(12), "一章"),
            _paragraph("乙乙乙", "二章"),
        ),
        LIMITS,
    )
    assert len(made) == 2
    assert "冷却水" not in made[1].text


def test_ordinals_are_dense_and_start_at_zero() -> None:
    """⚠ 它是 `(document_id, ordinal)` 那条唯一键的一半，跳号会让「第 5 块」
    在重新解析之后指向另一段文字。"""
    made = StructuralChunker().split(
        _document(
            _paragraph(_sentences(12), "一"),
            _paragraph(_sentences(12), "二"),
            _paragraph(_sentences(12), "三"),
        ),
        LIMITS,
    )
    assert [one.ordinal for one in made] == [0, 1, 2]


def test_an_empty_document_yields_nothing() -> None:
    assert StructuralChunker().split(_document(), LIMITS) == ()
    assert FixedWindowChunker().split(_document(), LIMITS) == ()
    assert RowChunker().split(_document(), LIMITS) == ()


def test_window_cuts_by_length_with_overlap() -> None:
    made = FixedWindowChunker().split(_document(_paragraph("字" * 250)), TINY)
    assert len(made) >= 3
    assert all(estimated(one.text) <= TINY.max_tokens for one in made)


def test_window_never_spins_when_overlap_swallows_the_window() -> None:
    """⚠ 重叠不小于窗口时步长会变成 0，原地打转切出无穷多块——
    那是一次内存耗尽而不是一条错误。"""
    made = FixedWindowChunker().split(
        _document(_paragraph("字" * 20)),
        ChunkLimits(max_tokens=5, min_tokens=0, overlap_chars=99),
    )
    assert 0 < len(made) <= 20


def test_rows_keeps_one_block_per_chunk() -> None:
    """表格的每一行本来就是一条独立记录，攒几行进一块会让检索命中整片
    而指不出是哪一条。"""
    made = RowChunker().split(
        _document(
            Block(kind="table_row", text="甲=1", locator=Locator(row=1)),
            Block(kind="table_row", text="乙=2", locator=Locator(row=2)),
        ),
        LIMITS,
    )
    assert len(made) == 2
    assert made[1].locator.row == 2


def test_rows_cuts_a_row_that_is_wider_than_the_window() -> None:
    """⚠ 一格里粘着整篇说明是现场常事，而那一行不断开的话超出的那一截会被
    嵌入端点悄悄丢掉。"""
    made = RowChunker().split(
        _document(Block(kind="table_row", text=_sentences(40))), TINY
    )
    assert len(made) > 1
    assert all(estimated(one.text) <= TINY.max_tokens for one in made)


def test_rows_drops_blank_blocks() -> None:
    made = RowChunker().split(
        _document(_paragraph("甲"), _paragraph("   "), _paragraph("乙")), LIMITS
    )
    assert [one.ordinal for one in made] == [0, 1]


def test_the_limits_come_from_the_embedding_window() -> None:
    """⚠ 上限是窗口折出来的，不是切块层自己的常量：端点对超窗那一截静默
    截断，而切块层赌输了没有任何一处报错。"""
    assert limits_for(512, 80, 120).max_tokens == 460
    assert limits_for(8_192, 80, 120).max_tokens == 7_372


def test_a_minimum_larger_than_the_ceiling_is_clamped() -> None:
    """⚠ 下限配得比上限还大的话，任何一块都攒不到「够了」，整份文档会被攒成
    一块——而那一块必然超窗。"""
    made = limits_for(100, 9_999, 9_999)
    assert made.min_tokens <= made.max_tokens
    assert made.overlap_chars <= made.max_tokens


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


def test_the_oversized_guard_catches_what_will_not_fit() -> None:
    """⚠ 它守的那件事永远不会自己冒出来：超窗的块不报错，只是后半段没进
    向量。等它在生产里露头时，露的是「这一段明明有，就是搜不到」。"""
    fits = Chunk(ordinal=0, text="甲", token_count=TINY.max_tokens)
    over = Chunk(ordinal=1, text="乙", token_count=TINY.max_tokens + 1)
    assert oversized((fits, over), TINY) == (over,)


def test_the_structural_lane_never_trips_the_guard() -> None:
    """⚠ 这两条要一起看：上一条证明闸门拦得住，这一条证明正常那一路不会
    撞上它——只有前者的话，把上限调到 0 也能让它绿。"""
    made = StructuralChunker().split(
        _document(
            _paragraph(_sentences(300), "一章", "1.1"),
            _paragraph("短", "一章", "1.2"),
            _paragraph(_sentences(300), "二章"),
        ),
        LIMITS,
    )
    assert len(made) > 2
    assert oversized(made, LIMITS) == ()


def test_the_heading_is_not_echoed_twice_in_the_body() -> None:
    """⚠ 前缀已经拼过一次标题路径，标题块自己又是一块——不去重的话正文是
    「二、运行参数\\n二、运行参数\\n下表为…」。它白占窗口预算，还把同一句话
    在向量里加权两次，而两处单看都是对的。"""
    made = StructuralChunker().split(
        _document(
            Block(
                kind="heading",
                text="二、运行参数",
                level=1,
                locator=Locator(page=2, path=("二、运行参数",)),
            ),
            Block(
                kind="paragraph",
                text=_sentences(12),
                locator=Locator(page=2, path=("二、运行参数",)),
            ),
        ),
        LIMITS,
    )
    assert len(made) == 1
    assert made[0].text.count("二、运行参数") == 1
    assert made[0].heading_path == "二、运行参数"


def test_a_heading_that_is_not_the_path_tail_stays_in_the_body() -> None:
    """⚠ 只在「开头那一块正是路径最后一节」时去重：攒过小节的块里，那几个
    小节标题都还在正文里，去掉任何一个都会让读的人看不出内容属于哪一节。"""
    made = StructuralChunker().split(
        _document(
            _paragraph("甲甲甲", "报告", "一"),
            Block(
                kind="heading",
                text="二",
                level=2,
                locator=Locator(path=("报告", "二")),
            ),
            _paragraph("乙乙乙", "报告", "二"),
        ),
        LIMITS,
    )
    assert len(made) == 1
    assert made[0].heading_path == "报告"
    assert "二" in made[0].text
