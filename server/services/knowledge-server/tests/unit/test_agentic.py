"""带补检的检索循环。用假模型跑——用例不许打真端点。"""

import uuid
from dataclasses import dataclass, field

import pytest

from knowledge_server.apps.knowledge.services.llm import (
    AnswerUnavailable,
    NullAnswerer,
)
from knowledge_server.apps.knowledge.services.parsing import Locator
from knowledge_server.apps.knowledge.services.retrieval import (
    Agentic,
    Hit,
    RetrievalRequest,
    RetrievalResult,
    RetrievalUnavailable,
)


@dataclass
class _Answerer:
    """按 system 提示词分档回话的假模型。"""

    queries: str = '["出口温度", "冷却水"]'
    grade: str = "no"
    answer: str = "出口温度不得高于 65 ℃ [1]"
    can_answer: bool = True
    seen: list[tuple[str, str]] = field(default_factory=list)

    async def complete(self, system: str, user: str) -> str:
        self.seen.append((system, user))
        if "改写检索式" in system:
            return self.queries
        if "够不够" in system:
            return self.grade
        return self.answer


@dataclass
class _Hybrid:
    """按调用次数吐不同结果的假混合检索。"""

    batches: list[tuple[Hit, ...]] = field(default_factory=list)
    calls: int = 0

    async def retrieve(
        self, session: object, request: RetrievalRequest
    ) -> RetrievalResult:
        del session, request
        made = (
            self.batches[self.calls] if self.calls < len(self.batches) else ()
        )
        self.calls += 1
        return RetrievalResult(hits=made, strategy="hybrid")


def _hit(text: str, score: float = 0.9) -> Hit:
    return Hit(
        chunk_id=uuid.uuid4(),
        document_id=uuid.uuid4(),
        document_title="手册.md",
        text=text,
        heading_path="冷却水",
        locator=Locator(page=12),
        score=score,
        why="余弦 0.9",
    )


def _agentic(hybrid: _Hybrid, answerer: _Answerer) -> Agentic:
    return Agentic(
        hybrid=hybrid,  # pyright: ignore[reportArgumentType]
        answerer=answerer,  # pyright: ignore[reportArgumentType]
    )


def _request() -> RetrievalRequest:
    return RetrievalRequest(base_id=uuid.uuid4(), query="出口温度多少", limit=3)


async def test_no_model_means_this_strategy_is_unavailable() -> None:
    """⚠ 如实不可用，**不悄悄退化成 hybrid**：悄悄退化的表现是「质量忽然
    变差了」，而没有任何一处报错。"""
    made = _agentic(_Hybrid(), _Answerer())
    absent = Agentic(hybrid=made.hybrid, answerer=NullAnswerer())
    with pytest.raises(RetrievalUnavailable):
        await absent.retrieve(
            None, _request()
        )  # pyright: ignore[reportArgumentType]


async def test_it_stops_as_soon_as_the_grader_says_enough() -> None:
    hybrid = _Hybrid(batches=[(_hit("甲"),)])
    made = await _agentic(hybrid, _Answerer(grade="yes")).retrieve(
        None,  # pyright: ignore[reportArgumentType]
        _request(),
    )
    assert made.rounds == 1
    assert made.is_complete is True


async def test_it_keeps_going_while_the_grader_says_not_enough() -> None:
    """⚠ 判不出来当**不够**：多查一轮的代价是几秒，而拿半份资料下结论的
    代价是一个看着很确定的错答案。"""
    hybrid = _Hybrid(batches=[(_hit("甲"),), (_hit("乙"),), (_hit("丙"),)])
    made = await _agentic(hybrid, _Answerer(grade="no")).retrieve(
        None,  # pyright: ignore[reportArgumentType]
        _request(),
    )
    assert made.rounds == 3


async def test_hitting_the_ceiling_says_so() -> None:
    """⚠ 到顶就把手上最好的那一批**连同「我没查全」一起**交出去，
    而不是装作查完了。"""
    hybrid = _Hybrid(batches=[(_hit("甲"),)])
    made = await _agentic(hybrid, _Answerer(grade="no")).retrieve(
        None,  # pyright: ignore[reportArgumentType]
        _request(),
    )
    assert made.is_complete is False
    assert "轮数上限" in made.note


async def test_every_rewritten_query_really_runs() -> None:
    hybrid = _Hybrid(batches=[(_hit("甲"),), (_hit("乙"),)])
    await _agentic(hybrid, _Answerer(grade="yes")).retrieve(
        None,  # pyright: ignore[reportArgumentType]
        _request(),
    )
    assert hybrid.calls == 2


async def test_a_broken_rewrite_falls_back_to_the_original_question() -> None:
    """⚠ 改写只是锦上添花：一次 JSON 解析失败不该让整次提问失败。"""
    hybrid = _Hybrid(batches=[(_hit("甲"),)])
    made = await _agentic(
        hybrid, _Answerer(queries="模型今天不想回 JSON", grade="yes")
    ).retrieve(
        None,  # pyright: ignore[reportArgumentType]
        _request(),
    )
    assert hybrid.calls == 1
    assert made.hits


async def test_the_same_chunk_never_comes_back_twice() -> None:
    """两轮召回撞上同一块时只留一份——留两份的话，角标 [1] 与 [2] 指着
    同一段文字，而模型会以为它有两个来源。"""
    same = _hit("甲")
    hybrid = _Hybrid(batches=[(same,), (same,)])
    made = await _agentic(hybrid, _Answerer(grade="no")).retrieve(
        None,  # pyright: ignore[reportArgumentType]
        _request(),
    )
    assert len(made.hits) == 1


async def test_no_hits_means_no_answer() -> None:
    """⚠ 一条都没召回时不去问模型：问了它只会凭常识编一段，
    而那段话没有任何一个角标指得到。"""
    made = await _agentic(_Hybrid(), _Answerer(grade="no")).retrieve(
        None,  # pyright: ignore[reportArgumentType]
        _request(),
    )
    assert made.answer == ""
    assert made.hits == ()


async def test_the_answer_prompt_numbers_the_snippets_from_one() -> None:
    """⚠ 片段顺序即角标：模型挂 [2] 的时候，那一条必须真的是第二段。
    乱序的话引用全指错，而看着完全正常。"""
    answerer = _Answerer(grade="yes")
    hybrid = _Hybrid(batches=[(_hit("甲", 0.9), _hit("乙", 0.8))])
    await _agentic(hybrid, answerer).retrieve(
        None,  # pyright: ignore[reportArgumentType]
        _request(),
    )
    prompt = answerer.seen[-1][1]
    assert "[1] 手册.md" in prompt
    assert prompt.index("[1]") < prompt.index("[2]")


async def test_the_null_answerer_raises_by_name() -> None:
    with pytest.raises(AnswerUnavailable):
        await NullAnswerer().complete("s", "u")
