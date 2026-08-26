"""模型调用外壳的失败分档。

**这个文件守的是本模块最要紧的一条判断**：哪一档失败该让断路器打开。
超时、连不上、限流、5xx 是「下游此刻不行」，该打开；401 与 400 是「我们自己
配错了或发错了」，绝不能打开——断路器一开，真正的原因就被盖成「暂时不可用」，
而那会让人去查网络。
"""

import httpx
import pytest
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage
from openai import (
    APIConnectionError,
    APITimeoutError,
    AuthenticationError,
    BadRequestError,
    OpenAIError,
    PermissionDeniedError,
    RateLimitError,
)

from ai_assistant.llm import GuardedModel, ModelRejected, ModelUnavailable
from ai_assistant.llm.guard import usage_of
from ai_assistant.llm.provider import ModelChoice
from lib.resilience import CircuitBreaker
from lib.testing.clock import FrozenClock
from unit.llm_fakes import ScriptedChat, StreamingChat

THRESHOLD = 2


RESET_AFTER_S = 30.0


def _guarded(
    model: BaseChatModel, clock: FrozenClock | None = None
) -> tuple[GuardedModel, CircuitBreaker]:
    breaker = CircuitBreaker(
        name="model",
        failure_threshold=THRESHOLD,
        reset_after_s=RESET_AFTER_S,
        clock=clock or FrozenClock(),
    )

    async def source(_choice: ModelChoice) -> BaseChatModel:
        return model

    return GuardedModel(source=source, breaker=breaker), breaker


async def _respond(guarded: GuardedModel) -> AIMessage:
    return await guarded.respond(
        choice=ModelChoice(),
        messages=[HumanMessage(content="你好")],
        tools=[],
    )


def _request() -> httpx.Request:
    return httpx.Request("POST", "http://model.test/v1/chat/completions")


def _response(status: int) -> httpx.Response:
    return httpx.Response(status_code=status, request=_request())


async def test_a_normal_reply_comes_back_and_keeps_the_breaker_closed() -> None:
    guarded, breaker = _guarded(ScriptedChat(reply=AIMessage(content="好")))
    reply = await _respond(guarded)
    assert reply.content == "好"
    assert breaker.state == "closed"


async def test_a_timeout_is_reported_as_unavailable() -> None:
    guarded, _ = _guarded(ScriptedChat(error=APITimeoutError(_request())))
    with pytest.raises(ModelUnavailable):
        await _respond(guarded)


async def test_repeated_timeouts_open_the_breaker() -> None:
    guarded, breaker = _guarded(ScriptedChat(error=APITimeoutError(_request())))
    for _ in range(THRESHOLD):
        with pytest.raises(ModelUnavailable):
            await _respond(guarded)
    assert breaker.state == "open"


async def test_a_connection_failure_counts_toward_the_breaker() -> None:
    guarded, breaker = _guarded(
        ScriptedChat(error=APIConnectionError(request=_request()))
    )
    for _ in range(THRESHOLD):
        with pytest.raises(ModelUnavailable):
            await _respond(guarded)
    assert breaker.state == "open"


async def test_rate_limiting_counts_toward_the_breaker() -> None:
    error = RateLimitError("慢一点", response=_response(429), body=None)
    guarded, breaker = _guarded(ScriptedChat(error=error))
    for _ in range(THRESHOLD):
        with pytest.raises(ModelUnavailable):
            await _respond(guarded)
    assert breaker.state == "open"


async def test_bad_credentials_never_open_the_breaker() -> None:
    error = AuthenticationError("凭据不对", response=_response(401), body=None)
    guarded, breaker = _guarded(ScriptedChat(error=error))
    for _ in range(THRESHOLD + 2):
        with pytest.raises(ModelRejected):
            await _respond(guarded)
    # 断路器一开，「密钥配错了」就被盖成「暂时不可用」，而那会让人去查网络
    assert breaker.state == "closed"


async def test_a_malformed_request_never_opens_the_breaker() -> None:
    error = BadRequestError("参数不对", response=_response(400), body=None)
    guarded, breaker = _guarded(ScriptedChat(error=error))
    for _ in range(THRESHOLD + 2):
        with pytest.raises(ModelRejected):
            await _respond(guarded)
    assert breaker.state == "closed"


async def test_an_open_breaker_short_circuits_without_calling_the_model() -> (
    None
):
    model = ScriptedChat(error=APITimeoutError(_request()))
    guarded, _ = _guarded(model)
    for _ in range(THRESHOLD):
        with pytest.raises(ModelUnavailable):
            await _respond(guarded)
    calls_before = model.calls
    with pytest.raises(ModelUnavailable):
        await _respond(guarded)
    # 短路的意义就是不再打下游，多一次调用就等于这条闸没起作用
    assert model.calls == calls_before


async def test_a_recovery_closes_the_breaker_again() -> None:
    clock = FrozenClock()
    model = ScriptedChat(error=APITimeoutError(_request()))
    guarded, breaker = _guarded(model, clock)
    for _ in range(THRESHOLD):
        with pytest.raises(ModelUnavailable):
            await _respond(guarded)
    assert breaker.state == "open"

    clock.advance(RESET_AFTER_S)
    model.error = None
    model.reply = AIMessage(content="回来了")
    reply = await _respond(guarded)

    assert reply.content == "回来了"
    assert breaker.state == "closed"


async def test_a_forbidden_call_is_rejected_without_opening_the_breaker() -> (
    None
):
    error = PermissionDeniedError("不允许", response=_response(403), body=None)
    guarded, breaker = _guarded(ScriptedChat(error=error))
    with pytest.raises(ModelRejected):
        await _respond(guarded)
    assert breaker.state == "closed"


async def test_a_reply_that_is_not_an_assistant_message_is_refused() -> None:
    # 造一个空的往下走，会让编排层以为模型「什么都没说」，于是回合正常结束、
    # 界面上是一条空气泡——那比响亮失败难查得多
    guarded, _ = _guarded(
        ScriptedChat(reply=HumanMessage(content="我不是助手"))
    )
    with pytest.raises(ModelUnavailable):
        await _respond(guarded)


async def test_an_unclassified_failure_still_reads_as_unavailable() -> None:
    # 归因表认不出的那一档也要有话说：空原因会在界面上显示成一条没有内容的错
    guarded, breaker = _guarded(ScriptedChat(error=OpenAIError("说不清")))
    with pytest.raises(ModelUnavailable) as error:
        await _respond(guarded)
    assert str(error.value)
    assert breaker.state == "closed"


async def _stream(
    guarded: GuardedModel, sink: list[tuple[str, str]]
) -> AIMessage:
    return await guarded.respond(
        choice=ModelChoice(),
        messages=[HumanMessage(content="你好")],
        tools=[],
        on_delta=lambda channel, text: sink.append((channel, text)),
    )


async def test_streaming_hands_every_block_to_the_sink() -> None:
    """模型说的每一小块都要当场交出去。

    ⚠ 攒完再一次给的话，用户在模型作答的十几秒里看到的是一片空白。
    """
    guarded, _ = _guarded(
        StreamingChat(parts=[("好的", "先查点位"), ("，我来绑", "")])
    )
    seen: list[tuple[str, str]] = []
    reply = await _stream(guarded, seen)

    # 思考排在正文前面：同一块里两路都有时，先想后说才是它们发生的顺序
    assert seen == [
        ("reasoning", "先查点位"),
        ("text", "好的"),
        ("text", "，我来绑"),
    ]
    assert reply.content == "好的，我来绑"


async def test_streaming_still_assembles_the_tool_calls() -> None:
    """工具调用在流里是逐段来的，攒的必须是**块的加法**。

    ⚠ 自己拼字符串只拼得出正文，工具调用会整批丢掉——表现是
    「模型只会说话不会动手」。
    """
    guarded, _ = _guarded(
        StreamingChat(
            parts=[("", "")],
            tool_chunks=[
                {
                    "name": "points.search",
                    "args": '{"keyword":"温度"}',
                    "id": "c1",
                    "index": 0,
                }
            ],
        )
    )
    reply = await _stream(guarded, [])

    assert [call["name"] for call in reply.tool_calls] == ["points.search"]


async def test_turning_streaming_off_ignores_the_sink() -> None:
    """部署把流式关掉时，`on_delta` 被忽略而不是报错。

    ⚠ 调用方不必为了「这套部署关了流式」再写一条分支。
    """
    model = StreamingChat(parts=[("好的", "先查点位")])
    breaker = CircuitBreaker(
        name="model",
        failure_threshold=THRESHOLD,
        reset_after_s=RESET_AFTER_S,
        clock=FrozenClock(),
    )

    async def source(_choice: ModelChoice) -> BaseChatModel:
        return model

    guarded = GuardedModel(source=source, breaker=breaker, is_streaming=False)
    seen: list[tuple[str, str]] = []
    reply = await _stream(guarded, seen)

    assert seen == []
    assert reply.content == "好的"


async def test_a_stream_that_fails_is_still_classified() -> None:
    """流式路上的失败与非流式同档，断路器照样计数。"""
    guarded, breaker = _guarded(
        StreamingChat(parts=[], error=APIConnectionError(request=_request()))
    )

    for _ in range(THRESHOLD):
        with pytest.raises(ModelUnavailable):
            await _stream(guarded, [])

    assert breaker.state == "open"


async def test_a_stream_that_says_nothing_is_not_an_empty_bubble() -> None:
    """一块都没吐就是模型没答上来，不是「它说了句空话」。

    ⚠ 造一条空消息交出去的话，回合会正常结束，界面上是一条空气泡。
    """
    guarded, _ = _guarded(StreamingChat(parts=[]))

    with pytest.raises(ModelUnavailable):
        await _stream(guarded, [])


def test_usage_reads_the_cache_hit_off_a_reply() -> None:
    """缓存命中数要能从回包里读出来。

    ⚠ 读不出来时它是 0，而 0 与「真的一次都没命中」长得一模一样——上下文工程
    的全部效果都靠这一格来验，所以键名在这里钉死。
    """
    reply = AIMessage(
        content="好的",
        usage_metadata={
            "input_tokens": 5000,
            "output_tokens": 40,
            "total_tokens": 5040,
            "input_token_details": {"cache_read": 4608},
        },
    )

    assert usage_of(reply) == {"prompt": 5000, "cached": 4608, "output": 40}


def test_a_reply_without_usage_is_not_a_failure() -> None:
    # 端点不回用量是常有的事，那时该少一条日志，而不是掉一次作答
    assert usage_of(AIMessage(content="好的")) is None
