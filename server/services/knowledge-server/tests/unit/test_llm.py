"""知识库这一侧的模型调用面：分档、断路、正文抽取。"""

import httpx
import pytest
from openai import APIConnectionError, AuthenticationError, OpenAIError

from knowledge_server.apps.knowledge.services.llm import (
    Answerer,
    AnswerUnavailable,
    ChatAnswerer,
    NullAnswerer,
    _text_of,
    build_answerer,
)
from lib.resilience import CircuitBreaker
from lib.testing.clock import FrozenClock
from llmcore.errors import ModelRejected, ModelUnavailable

_REQUEST = httpx.Request("POST", "http://endpoint/v1/chat/completions")


class _Reply:
    def __init__(self, content: object) -> None:
        self.content = content


class _Model:
    def __init__(
        self, *, reply: object = "答案", error: Exception | None = None
    ) -> None:
        self._reply = reply
        self._error = error

    async def ainvoke(self, messages: object) -> _Reply:
        del messages
        if self._error is not None:
            raise self._error
        return _Reply(self._reply)


class _Adapter:
    def __init__(self, model: _Model) -> None:
        self._model = model

    def supports(self, kind: str) -> bool:
        del kind
        return True

    async def build(self, choice: object) -> _Model:
        del choice
        return self._model


def _answerer(model: _Model) -> tuple[ChatAnswerer, CircuitBreaker]:
    breaker = CircuitBreaker(
        name="t", failure_threshold=2, reset_after_s=30, clock=FrozenClock()
    )
    made = ChatAnswerer(
        adapter=_Adapter(model),  # pyright: ignore[reportArgumentType]
        breaker=breaker,
    )
    return (made, breaker)


async def test_a_plain_string_reply_comes_back_as_is() -> None:
    made, _ = _answerer(_Model(reply="出口温度 65 ℃"))
    assert await made.complete("s", "u") == "出口温度 65 ℃"


async def test_a_block_reply_is_flattened() -> None:
    """⚠ 各家端点的正文口径不同：按字符串处理的话，回块的那些端点给出来的是
    一句 `[{'type': 'text', ...}]` 的字面量——看着像答案，实际是一段 repr。"""
    made, _ = _answerer(
        _Model(reply=[{"type": "text", "text": "甲"}, {"text": "乙"}])
    )
    assert await made.complete("s", "u") == "甲乙"


def test_an_unknown_content_shape_reads_as_empty() -> None:
    assert _text_of(None) == ""
    assert _text_of(42) == ""


async def test_bad_credentials_never_open_the_breaker() -> None:
    """⚠ 断路器一开，真正的原因（密钥配错了）就被盖成「暂时不可用」，
    而那会让人去查网络。"""
    error = AuthenticationError(
        "", response=httpx.Response(401, request=_REQUEST), body=None
    )
    made, _breaker = _answerer(_Model(error=error))
    # 阈值是 2；问四次都该是「我们发错了」而不是「暂时不可用」——
    # 断路器一次都没计数，所以它始终没打开
    for _ in range(4):
        with pytest.raises(ModelRejected):
            await made.complete("s", "u")


async def test_a_downstream_failure_opens_the_breaker() -> None:
    """⚠ 超时、连不上、限流、5xx 是「下游此刻不行」——该短路，
    短路能省下白等的时间。"""
    made, _ = _answerer(_Model(error=APIConnectionError(request=_REQUEST)))
    with pytest.raises(ModelUnavailable):
        await made.complete("s", "u")
    with pytest.raises(ModelUnavailable):
        await made.complete("s", "u")
    # 到阈值之后再问，短路直接挡下来，压根不打端点
    with pytest.raises(ModelUnavailable):
        await made.complete("s", "u")


async def test_an_unclassified_error_still_reads_as_unavailable() -> None:
    made, _ = _answerer(_Model(error=OpenAIError("说不清")))
    with pytest.raises(ModelUnavailable):
        await made.complete("s", "u")


def test_nothing_wired_gives_a_null_answerer() -> None:
    breaker = CircuitBreaker(name="t", failure_threshold=1, reset_after_s=1)
    made = build_answerer(None, breaker)
    assert isinstance(made, NullAnswerer)
    assert made.can_answer is False
    assert isinstance(made, Answerer)


async def test_the_null_answerer_raises_instead_of_answering_empty() -> None:
    """⚠ 回空串的话，调用方会把「没接模型」当成「模型没话说」，
    然后把一个空答案交给用户。"""
    with pytest.raises(AnswerUnavailable):
        await NullAnswerer().complete("s", "u")
