"""模型调用的外壳：断路、失败分档、流式攒回一条、线形改写的钩子。

⚠ 哪一档失败该让断路器打开，是这一层最要紧的判断：下游此刻不行（超时、5xx）
该打开；我们自己配错了（401、400）绝不能打开——打开等于把真因盖成「暂时不可用」。
助手那边另有一份把订阅账号的改写也串进来的用例；这里只验通用的那几条。
"""

from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

import httpx
import pytest
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from openai import APIConnectionError, AuthenticationError

from lib.resilience import CircuitBreaker
from llmcore import ModelChoice, ModelRejected, ModelUnavailable
from llmcore.guard import GuardedModel, ToolDecl, usage_of
from llmcore.testing import ScriptedChat, StreamingChat


def _guarded(
    model: BaseChatModel, **extra: Any
) -> tuple[GuardedModel, CircuitBreaker]:
    breaker = CircuitBreaker(name="t", failure_threshold=1, reset_after_s=60)

    async def source(_choice: ModelChoice) -> BaseChatModel:
        return model

    return GuardedModel(source=source, breaker=breaker, **extra), breaker


def _auth_error() -> AuthenticationError:
    request = httpx.Request("POST", "http://x")
    return AuthenticationError(
        "bad key", response=httpx.Response(401, request=request), body=None
    )


def _conn_error() -> APIConnectionError:
    return APIConnectionError(request=httpx.Request("POST", "http://x"))


async def test_a_plain_reply_comes_back_as_one_ai_message() -> None:
    guarded, _ = _guarded(ScriptedChat(reply=AIMessage(content="好")))

    got = await guarded.respond(
        choice=ModelChoice(), messages=[HumanMessage(content="嗨")], tools=()
    )

    assert got.content == "好"


async def test_our_own_fault_never_opens_the_breaker() -> None:
    """⚠ 401 一开断路器，密钥配错就被盖成「暂时不可用」，人会去查网络。"""
    guarded, breaker = _guarded(ScriptedChat(error=_auth_error()))

    with pytest.raises(ModelRejected):
        await guarded.respond(choice=ModelChoice(), messages=[], tools=())

    assert breaker.state != "open"


async def test_a_downstream_outage_opens_the_breaker() -> None:
    guarded, breaker = _guarded(ScriptedChat(error=_conn_error()))

    with pytest.raises(ModelUnavailable):
        await guarded.respond(choice=ModelChoice(), messages=[], tools=())

    assert breaker.state == "open"


async def test_an_open_breaker_short_circuits_without_calling() -> None:
    model = ScriptedChat(error=_conn_error())
    guarded, _ = _guarded(model)
    with pytest.raises(ModelUnavailable):
        await guarded.respond(choice=ModelChoice(), messages=[], tools=())

    with pytest.raises(ModelUnavailable):
        await guarded.respond(choice=ModelChoice(), messages=[], tools=())

    assert model.calls == 1


async def test_streaming_hands_out_deltas_and_still_returns_the_whole() -> None:
    """⚠ 增量是顺路交出去的，不是替代品：回的仍是攒齐的那一条。"""
    guarded, _ = _guarded(StreamingChat(parts=[("你", ""), ("好", "")]))
    seen: list[tuple[str, str]] = []

    got = await guarded.respond(
        choice=ModelChoice(),
        messages=[],
        tools=(),
        on_delta=lambda channel, text: seen.append((channel, text)),
    )

    assert got.content == "你好"
    assert [text for _, text in seen] == ["你", "好"]


async def test_streaming_keeps_tool_calls_that_arrive_in_pieces() -> None:
    """⚠ 自己拼字符串只能拼出正文，工具调用会整批丢掉——「只会说话不会动手」。"""
    guarded, _ = _guarded(
        StreamingChat(
            tool_chunks=[
                {"name": "kb.search", "args": '{"q":', "id": "c1", "index": 0},
                {"name": None, "args": '"锅炉"}', "id": None, "index": 0},
            ]
        )
    )

    got = await guarded.respond(
        choice=ModelChoice(), messages=[], tools=(), on_delta=lambda *_: None
    )

    assert [call["name"] for call in got.tool_calls] == ["kb.search"]


async def test_an_empty_stream_is_reported_not_swallowed() -> None:
    """⚠ 不接住的话它会穿过整个编排层，表现为流突然断掉、界面上没有任何错。"""
    guarded, _ = _guarded(StreamingChat(parts=[]))

    with pytest.raises(ModelUnavailable):
        await guarded.respond(
            choice=ModelChoice(),
            messages=[],
            tools=(),
            on_delta=lambda *_: None,
        )


async def test_streaming_switched_off_ignores_the_sink() -> None:
    guarded, _ = _guarded(StreamingChat(parts=[("好", "")]), is_streaming=False)
    seen: list[str] = []

    await guarded.respond(
        choice=ModelChoice(),
        messages=[],
        tools=(),
        on_delta=lambda _c, text: seen.append(text),
    )

    assert seen == []


@dataclass
class _Rewire:
    """记账的假改写：出去时给每个工具名加后缀，回来时去掉。"""

    outbound_calls: int = 0
    inbound_calls: int = 0
    seen_choice: list[ModelChoice] = field(default_factory=list[ModelChoice])

    def applies(self, choice: ModelChoice) -> bool:
        self.seen_choice.append(choice)
        return choice.profile == "special"

    def outbound(
        self, tools: Sequence[ToolDecl], messages: list[BaseMessage]
    ) -> tuple[list[ToolDecl], list[BaseMessage]]:
        self.outbound_calls += 1
        return list(tools), messages

    def inbound(self, reply: AIMessage) -> AIMessage:
        self.inbound_calls += 1
        return reply


async def test_the_rewire_hook_runs_both_ways_only_when_it_applies() -> None:
    """⚠ 两头都要改：只改出去的那一头，回来的调用名对不上注册表。"""
    hook = _Rewire()
    guarded, _ = _guarded(ScriptedChat(), rewire=hook)

    await guarded.respond(
        choice=ModelChoice(profile="special"), messages=[], tools=()
    )
    await guarded.respond(
        choice=ModelChoice(profile="default"), messages=[], tools=()
    )

    assert (hook.outbound_calls, hook.inbound_calls) == (1, 1)


def test_usage_reads_the_cache_hit_count_by_its_langchain_key() -> None:
    """⚠ 映法一变这里静默变成 0，而 0 与「真的一次都没命中」长得一模一样。"""
    reply = AIMessage(
        content="",
        usage_metadata={
            "input_tokens": 100,
            "output_tokens": 5,
            "total_tokens": 105,
            "input_token_details": {"cache_read": 80},
        },
    )

    assert usage_of(reply) == {"prompt": 100, "cached": 80, "output": 5}


def test_no_usage_is_none_not_zero() -> None:
    assert usage_of(AIMessage(content="")) is None
