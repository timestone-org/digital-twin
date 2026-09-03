"""引用角标：发号、解析、以及「用到了才算引用」。

⚠ 这一层不打库。账本与角标是纯逻辑，而「被引块的图」那一步由集成用例验。
"""

import uuid

import pytest

from knowledge_server.apps.chat.services.citations import Ledger
from knowledge_server.apps.chat.services.markers import (
    MAX_CIRCLED,
    marker_of,
    numbers_in,
)
from knowledge_server.apps.knowledge.schemas import HitOut, LocatorOut


def _hit(chunk: uuid.UUID, page: int = 2, title: str = "现场手册") -> HitOut:
    return HitOut(
        chunk_id=chunk,
        document_id=uuid.UUID(int=7),
        document_title=title,
        text="出口温度不得高于 65 ℃",
        heading_path="二、运行参数",
        locator=LocatorOut(page=page, label=f"第 {page} 页 · 二、运行参数"),
        score=0.9,
        why="向量近邻 0.9",
    )


@pytest.mark.parametrize(
    ("number", "want"),
    [(1, "①"), (20, "⑳"), (21, "㉑"), (35, "㉟"), (36, "㊱"), (50, "㊿")],
)
def test_every_number_up_to_fifty_has_a_circled_character(
    number: int, want: str
) -> None:
    """⚠ 三段码位是 Unicode 自己的排布，不是我们挑的：①–⑳ 之后并不接着 ㉑。
    少一段的表现是第 21 条起角标变成方括号，而那与正文里的标准号撞脸。"""
    assert marker_of(number) == want


def test_beyond_fifty_falls_back_to_parentheses() -> None:
    """⚠ 超过 50 之后没有字符可用。一回合里引到 50 段以上不现实，
    但兜底要有——不然那几条会拿到一个空角标。"""
    assert marker_of(MAX_CIRCLED + 1) == "(51)"


def test_markers_are_read_back_in_the_order_they_appear() -> None:
    """⚠ 去重但**保序**：引用面按「第一次被引到」的顺序摆，那与读的人扫过去
    的顺序一致。"""
    assert numbers_in("甲③，乙①。丙③又一次，丁⑤。") == [3, 1, 5]


def test_the_parenthesised_form_is_also_read() -> None:
    """⚠ 模型偶尔会把圆圈数字写成 (3)。只认一种的话那一次的引用整个丢掉，
    而答案看着完全正常。"""
    assert numbers_in("温度上限见 (3)。") == [3]


def test_ordinary_brackets_in_the_body_are_not_mistaken_for_markers() -> None:
    """⚠ 这正是不用 `[3]` 的理由：正文里本来就有标准号与数组下标。"""
    assert numbers_in("见 GB/T 4728 与数组 a[3]，共 12 项。") == []


def test_the_same_chunk_hit_twice_keeps_one_marker() -> None:
    """⚠ 同一块在两次检索里都被召回是常事（换个说法再查一轮）。不复用的话，
    同一段话会拿到两个角标，而引用面上它出现两次。"""
    ledger = Ledger()
    one = uuid.UUID(int=1)
    assert ledger.mark(_hit(one), "手册库", "正文") == "①"
    assert ledger.mark(_hit(one), "手册库", "正文") == "①"
    assert len(ledger.issued) == 1


def test_markers_run_on_across_several_searches() -> None:
    """⚠ 编号要跨多次检索连续，而模型只看得见这一次的回执——所以号由服务端
    发，不让模型自己编。"""
    ledger = Ledger()
    marks = [
        ledger.mark(_hit(uuid.UUID(int=at)), "手册库", "正文")
        for at in range(1, 4)
    ]
    assert marks == ["①", "②", "③"]


def test_only_the_markers_the_answer_used_come_back() -> None:
    """⚠ 这是这一轮的核心：检索回执里那十来条，模型多半只用了两三条。
    把查到的全列出来等于让用户自己找哪几条支撑了那句话。"""
    ledger = Ledger()
    for at in range(1, 6):
        ledger.mark(_hit(uuid.UUID(int=at)), "手册库", "正文")
    found = ledger.resolve(numbers_in("上限 65 ℃③，另见④。"))
    assert [one.marker for one in found] == ["③", "④"]


def test_a_marker_that_was_never_issued_is_dropped() -> None:
    """⚠ 模型偶尔会写一个没发过的角标。为它画一个点不动的空引用比不画更糟。"""
    ledger = Ledger()
    ledger.mark(_hit(uuid.UUID(int=1)), "手册库", "正文")
    assert ledger.resolve(numbers_in("见⑨。")) == []


def test_an_answer_without_markers_yields_no_citations() -> None:
    """⚠ 扫不出角标 = **不出引用块**，而不是退回「把查到的都列出来」。"""
    ledger = Ledger()
    ledger.mark(_hit(uuid.UUID(int=1)), "手册库", "正文")
    assert ledger.resolve(numbers_in("我不知道。")) == []


def test_a_citation_carries_what_the_panel_needs() -> None:
    ledger = Ledger()
    ledger.mark(_hit(uuid.UUID(int=1), page=4), "手册库", "正文片段")
    one = ledger.issued[0]
    assert one.base_name == "手册库"
    assert one.document_title == "现场手册"
    assert one.where == "第 4 页 · 二、运行参数"
    assert one.page == 4
    assert one.text == "正文片段"
    assert one.figures == ()
