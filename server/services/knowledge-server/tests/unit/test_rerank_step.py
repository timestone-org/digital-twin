"""策略怎么用重排：多召一批、按新分截断、排不成就如实退回。

守的是那条最要紧的：**重排挂了不许把整次检索带塌**，而且退回融合名次时要
说出来——不说的话，质量忽然变了却没有任何一处报错。
"""

import uuid
from collections.abc import Sequence

import pytest

from knowledge_server.apps.knowledge.services.parsing import Locator
from knowledge_server.apps.knowledge.services.reranking import (
    NullReranker,
    RerankFailed,
)
from knowledge_server.apps.knowledge.services.retrieval import (
    RERANK_FAILED_NOTE,
    RERANK_MAX_CANDIDATES,
    RERANK_WIDEN,
    Hit,
    candidate_width,
    reranked,
)
from llmcore.rerank import RerankScore


class _Reranker:
    """按脚本回分的假重排；也可以恒抛。"""

    def __init__(
        self,
        scores: list[RerankScore] | None = None,
        *,
        can_rerank: bool = True,
        raises: Exception | None = None,
    ) -> None:
        self.id = "remote-rerank"
        self.model = "rerank-1"
        self.can_rerank = can_rerank
        self.scores = scores or []
        self.raises = raises
        self.asked: list[tuple[str, list[str], int]] = []

    async def rerank(
        self, query: str, documents: Sequence[str], *, top_n: int
    ) -> list[RerankScore]:
        self.asked.append((query, list(documents), top_n))
        if self.raises is not None:
            raise self.raises
        return self.scores


def _hit(text: str, score: float = 0.5) -> Hit:
    return Hit(
        chunk_id=uuid.uuid4(),
        document_id=uuid.uuid4(),
        document_title="手册.md",
        text=text,
        heading_path="冷却水",
        locator=Locator(page=1),
        score=score,
        why="余弦 0.5",
    )


def test_the_candidate_width_is_wider_than_what_is_asked_for() -> None:
    """⚠ 只送 limit 条的话，重排能做的只有把这几条换个顺序。"""
    assert candidate_width(5) == 5 * RERANK_WIDEN


def test_the_candidate_width_is_capped() -> None:
    """⚠ 每条候选的全文都随请求发出去：不封顶就是一次必然超限的调用。"""
    assert candidate_width(50) == RERANK_MAX_CANDIDATES


async def test_an_absent_lane_just_truncates_and_says_nothing() -> None:
    """⚠ 没接是这套部署的常态，说它的地方是 /capabilities——
    每次检索都念一句的话，真正的失败反而被淹掉。"""
    rows = [_hit("甲"), _hit("乙"), _hit("丙")]
    hits, note = await reranked(NullReranker(), "问", rows, 2)
    assert [one.text for one in hits] == ["甲", "乙"]
    assert note == ""


async def test_an_empty_batch_never_reaches_the_endpoint() -> None:
    lane = _Reranker([])
    hits, note = await reranked(lane, "问", [], 3)
    assert hits == ()
    assert note == ""
    assert lane.asked == []


async def test_the_new_order_wins_and_carries_its_score() -> None:
    rows = [_hit("甲"), _hit("乙"), _hit("丙")]
    lane = _Reranker(
        [
            RerankScore(index=2, score=0.91),
            RerankScore(index=0, score=0.42),
            RerankScore(index=1, score=0.11),
        ]
    )
    hits, note = await reranked(lane, "出口温度", rows, 2)
    assert [one.text for one in hits] == ["丙", "甲"]
    assert hits[0].score == pytest.approx(0.91)
    assert "重排" in hits[0].why
    assert note == ""
    assert lane.asked == [("出口温度", ["甲", "乙", "丙"], 2)]


async def test_a_zero_scored_candidate_is_not_returned() -> None:
    """⚠ 打分只排序不取舍，得分为 0 的一律不返回（设计文档 §1.3）：
    硬凑几条出来的话，调用方会以为「就这些了」然后从里面挑一条。"""
    rows = [_hit("甲"), _hit("乙")]
    lane = _Reranker(
        [RerankScore(index=0, score=0.7), RerankScore(index=1, score=0.0)]
    )
    hits, _note = await reranked(lane, "问", rows, 5)
    assert [one.text for one in hits] == ["甲"]


async def test_a_failed_rerank_falls_back_and_says_so() -> None:
    """⚠ 重排是排序增强：它挂了不该让用户拿到一句「检索失败」，
    而资料明明查得到。反过来，**不标注**才是那条真正的坑。"""
    rows = [_hit("甲"), _hit("乙"), _hit("丙")]
    lane = _Reranker(raises=RerankFailed("端点未响应"))
    hits, note = await reranked(lane, "问", rows, 2)
    assert [one.text for one in hits] == ["甲", "乙"]
    assert note == RERANK_FAILED_NOTE
