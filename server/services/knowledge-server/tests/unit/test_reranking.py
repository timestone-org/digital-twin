"""重排那一层：缺席怎么说、失败落在哪一档、断路器让谁计数。

守的是那条最容易写反的判断：**只有「下游此刻不行」让断路器计数**。
密钥配错、方言配错都不该短路——断路器一开，真正的原因就被盖成
「暂时不可用」，而那会让人去查网络。
"""

from collections.abc import Sequence

import pytest

from knowledge_server.apps.knowledge.services.reranking import (
    NullReranker,
    RemoteReranker,
    Reranker,
    RerankFailed,
    build_reranker,
)
from lib.resilience import BreakerOpen, CircuitBreaker
from llmcore import ModelRejected, ModelUnavailable, RerankUnavailable
from llmcore.rerank import RerankScore, UnknownRerankDialect


class _Adapter:
    """替掉 llmcore 那一路的假件：想抛什么就抛什么。"""

    def __init__(
        self, *, is_ready: bool = True, raises: Exception | None = None
    ) -> None:
        self.id = "remote-rerank"
        self.is_ready = is_ready
        self.model = "rerank-1" if is_ready else None
        self.raises = raises
        self.asked: list[tuple[str, list[str], int]] = []

    async def rerank(
        self, query: str, documents: Sequence[str], *, top_n: int
    ) -> list[RerankScore]:
        self.asked.append((query, list(documents), top_n))
        if self.raises is not None:
            raise self.raises
        return [
            RerankScore(index=1, score=0.8),
            RerankScore(index=0, score=0.2),
        ]


def _breaker() -> CircuitBreaker:
    return CircuitBreaker(
        name="test:rerank", failure_threshold=2, reset_after_s=60.0
    )


def _made(adapter: _Adapter, breaker: CircuitBreaker) -> Reranker:
    return build_reranker(
        adapter,  # pyright: ignore[reportArgumentType]
        breaker,
    )


def test_both_implementations_satisfy_the_protocol() -> None:
    assert isinstance(NullReranker(), Reranker)
    assert isinstance(_made(_Adapter(), _breaker()), Reranker)


async def test_the_null_lane_refuses_by_name_instead_of_returning_nothing() -> (
    None
):
    """⚠ 回空表的话，调用方会把「没接重排」读成「一条都不相关」。"""
    with pytest.raises(RerankFailed):
        await NullReranker().rerank("问", ["甲"], top_n=1)


def test_readiness_and_the_model_name_come_from_the_adapter() -> None:
    assert _made(_Adapter(), _breaker()).id == "remote-rerank"
    absent = _made(_Adapter(is_ready=False), _breaker())
    assert absent.can_rerank is False
    assert absent.model is None
    present = _made(_Adapter(), _breaker())
    assert present.can_rerank is True
    assert present.model == "rerank-1"


async def test_a_successful_call_passes_the_batch_through() -> None:
    adapter = _Adapter()
    made = await _made(adapter, _breaker()).rerank("问", ["甲", "乙"], top_n=2)
    assert [one.index for one in made] == [1, 0]
    assert adapter.asked == [("问", ["甲", "乙"], 2)]


@pytest.mark.parametrize(
    "raised",
    [
        ModelRejected("端点拒了凭据"),
        RerankUnavailable("这套部署没有接重排档"),
        UnknownRerankDialect("这一侧没装叫 cohere-v3 的重排线形"),
    ],
    ids=["我们发错了", "没接", "方言没装"],
)
async def test_our_own_mistakes_never_open_the_breaker(
    raised: Exception,
) -> None:
    breaker = _breaker()
    made = _made(_Adapter(raises=raised), breaker)
    for _ in range(3):
        with pytest.raises(RerankFailed):
            await made.rerank("问", ["甲"], top_n=1)
    # ⚠ 短路了的话，下一次失败的原因会变成「暂时不可用」，
    # 而真正的原因（配错了）就此看不见
    breaker.guard()


async def test_downstream_trouble_opens_the_breaker() -> None:
    breaker = _breaker()
    made = _made(_Adapter(raises=ModelUnavailable("端点未响应")), breaker)
    for _ in range(2):
        with pytest.raises(RerankFailed):
            await made.rerank("问", ["甲"], top_n=1)
    with pytest.raises(BreakerOpen):
        breaker.guard()


async def test_an_open_breaker_is_still_a_rerank_failure_not_a_crash() -> None:
    """⚠ 短路了也只是「这次没排成」：让它抛穿的表现是用户拿到一句
    「检索失败」，而资料明明查得到。"""
    breaker = _breaker()
    made = _made(_Adapter(raises=ModelUnavailable("端点未响应")), breaker)
    for _ in range(2):
        with pytest.raises(RerankFailed):
            await made.rerank("问", ["甲"], top_n=1)
    with pytest.raises(RerankFailed):
        await made.rerank("问", ["甲"], top_n=1)


async def test_a_success_clears_the_failures_it_had_counted() -> None:
    """⚠ 不清零的话，一次偶发抖动会跟着进程活一辈子，
    最终在一个毫无关系的时刻把这一路短路掉。"""
    breaker = _breaker()
    adapter = _Adapter(raises=ModelUnavailable("端点未响应"))
    made = RemoteReranker(
        adapter=adapter,  # pyright: ignore[reportArgumentType]
        breaker=breaker,
    )
    with pytest.raises(RerankFailed):
        await made.rerank("问", ["甲"], top_n=1)
    adapter.raises = None
    await made.rerank("问", ["甲"], top_n=1)
    adapter.raises = ModelUnavailable("端点未响应")
    with pytest.raises(RerankFailed):
        await made.rerank("问", ["甲"], top_n=1)
    breaker.guard()
