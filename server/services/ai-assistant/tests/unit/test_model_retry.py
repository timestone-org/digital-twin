"""助手模型故障的等待、恢复与失败次数上限。"""

from asyncio import CancelledError
from collections.abc import AsyncIterator
from typing import Any
from unittest.mock import AsyncMock, call

import pytest
from langchain_core.callbacks import AsyncCallbackManagerForLLMRun
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    ToolMessage,
)
from langchain_core.outputs import ChatGenerationChunk
from openai import OpenAIError

from ai_assistant.apps.chat.services.model_retry import RetryingModel
from ai_assistant.llm import (
    GuardedModel,
    ModelChoice,
    ModelDisabled,
    ModelRejected,
    ModelUnavailable,
)
from lib.resilience import CircuitBreaker
from lib.testing.clock import FrozenClock
from llmcore.testing import ScriptedChat, StreamingChat, asks
from llmcore.tools.shapes import ToolSpec
from llmcore.turn.loop import TurnDeps, run_turn, stream_turn
from llmcore.turn.types import TurnDelta, TurnOutcome


@pytest.mark.parametrize("failures", [0, 1, 4])
async def test_a_transient_model_failure_does_not_end_the_turn(
    failures: int,
) -> None:
    model = ScriptedChat(error=OpenAIError("unavailable"))

    async def source(_choice: ModelChoice) -> BaseChatModel:
        if model.calls >= failures:
            model.error = None
            model.reply = AIMessage(content="恢复后继续回答")
        return model

    guarded = GuardedModel(source=source, breaker=CircuitBreaker(name="test"))
    wait = AsyncMock()
    outcome = await run_turn(
        TurnDeps(
            model=RetryingModel(guarded, wait), specs=(), run_tool=AsyncMock()
        ),
        [HumanMessage(content="继续")],
    )
    assert outcome.reply == "恢复后继续回答"
    assert model.calls == failures + 1
    assert wait.await_args_list == [call(10.0)] * failures


async def test_five_failures_stop_after_four_ten_second_waits() -> None:
    model = ScriptedChat(error=OpenAIError("unavailable"))

    async def source(_choice: ModelChoice) -> BaseChatModel:
        return model

    wait = AsyncMock()
    guarded = GuardedModel(source=source, breaker=CircuitBreaker(name="test"))
    with pytest.raises(ModelUnavailable, match="连续 5 次失败，已停止"):
        await RetryingModel(guarded, wait).respond(
            choice=ModelChoice(), messages=[], tools=[]
        )
    assert model.calls == 5
    assert wait.await_args_list == [call(10.0)] * 4


@pytest.mark.parametrize(
    "error", [ModelRejected("请求错误"), ModelDisabled("未配置")]
)
async def test_permanent_failures_are_not_retried(error: Exception) -> None:
    source = AsyncMock(side_effect=error)
    wait = AsyncMock()
    guarded = GuardedModel(source=source, breaker=CircuitBreaker(name="test"))
    with pytest.raises(type(error)):
        await RetryingModel(guarded, wait).respond(
            choice=ModelChoice(), messages=[], tools=[]
        )
    assert source.await_count == 1
    wait.assert_not_awaited()


async def test_cancelling_the_wait_stops_before_another_model_call() -> None:
    model = ScriptedChat(error=OpenAIError("unavailable"))

    async def source(_choice: ModelChoice) -> BaseChatModel:
        return model

    wait = AsyncMock(side_effect=CancelledError())
    guarded = GuardedModel(source=source, breaker=CircuitBreaker(name="test"))
    with pytest.raises(CancelledError):
        await RetryingModel(guarded, wait).respond(
            choice=ModelChoice(), messages=[], tools=[]
        )
    assert model.calls == 1


async def test_retry_does_not_repeat_a_completed_tool() -> None:
    model = ScriptedChat(script=[asks("lookup", "call-1")])

    async def source(_choice: ModelChoice) -> BaseChatModel:
        model.error = OpenAIError("unavailable") if model.calls == 1 else None
        model.reply = AIMessage(content="完成")
        return model

    guarded = GuardedModel(source=source, breaker=CircuitBreaker(name="test"))
    runner = AsyncMock(return_value="工具结果")
    outcome = await run_turn(
        TurnDeps(
            model=RetryingModel(guarded, AsyncMock()),
            specs=(
                ToolSpec(
                    name="lookup",
                    description="查询",
                    parameters={},
                    runs_on="server",
                ),
            ),
            run_tool=runner,
        ),
        [HumanMessage(content="查询")],
    )
    seen = model.seen
    assert outcome.reply == "完成"
    assert runner.await_count == 1
    assert seen[1] == seen[2]
    assert any(isinstance(message, ToolMessage) for message in seen[2])


async def test_an_open_breaker_is_respected_and_recovery_is_probed() -> None:
    clock = FrozenClock()
    breaker = CircuitBreaker(name="test", failure_threshold=1, clock=clock)
    model = ScriptedChat(error=OpenAIError("unavailable"))
    waits: list[float] = []

    async def source(_choice: ModelChoice) -> BaseChatModel:
        return model

    async def wait(delay_s: float) -> None:
        waits.append(delay_s)
        clock.advance(delay_s)
        model.error = None

    reply = await RetryingModel(
        GuardedModel(source=source, breaker=breaker), wait
    ).respond(choice=ModelChoice(), messages=[], tools=[])
    assert reply.content == "好的"
    assert model.calls == 2
    assert waits == [10.0, 10.0, 10.0]
    assert breaker.state == "closed"


async def test_stream_retries_and_persists_only_the_successful_reply() -> None:
    failed = StreamingChat(parts=[], error=OpenAIError("unavailable"))
    recovered = StreamingChat(parts=[("恢复", "分析"), ("完成", "")])
    source = AsyncMock(side_effect=[failed, recovered])
    guarded = GuardedModel(source=source, breaker=CircuitBreaker(name="test"))
    events = [
        item
        async for item in stream_turn(
            TurnDeps(
                model=RetryingModel(guarded, AsyncMock()),
                specs=(),
                run_tool=AsyncMock(),
            ),
            [HumanMessage(content="继续")],
        )
    ]
    deltas = [item for item in events if isinstance(item, TurnDelta)]
    assert "10 秒后重试" in deltas[0].text
    assert deltas[0].channel == "reasoning"
    assert (
        "".join(item.text for item in deltas if item.channel == "text")
        == "恢复完成"
    )
    outcome = events[-1]
    assert isinstance(outcome, TurnOutcome)
    assert outcome.reply == "恢复完成"
    assert len(outcome.messages) == 1


async def test_a_partial_stream_is_marked_interrupted_before_retry_output() -> (
    None
):
    failed = PartialStream(parts=[("未完成的回答", "")])
    recovered = StreamingChat(parts=[("完整回答", "")])
    source = AsyncMock(side_effect=[failed, recovered])
    guarded = GuardedModel(source=source, breaker=CircuitBreaker(name="test"))
    deltas: list[tuple[str, str]] = []
    reply = await RetryingModel(guarded, AsyncMock()).respond(
        choice=ModelChoice(),
        messages=[],
        tools=[],
        on_delta=lambda channel, text: deltas.append((channel, text)),
    )
    assert reply.content == "完整回答"
    texts = [text for channel, text in deltas if channel == "text"]
    assert texts == [
        "未完成的回答",
        "\n\n（上段响应中断，正在重新生成。）\n\n",
        "完整回答",
    ]


class PartialStream(StreamingChat):
    async def _astream(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: AsyncCallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> AsyncIterator[ChatGenerationChunk]:
        async for part in super()._astream(
            messages, stop, run_manager, **kwargs
        ):
            yield part
        raise OpenAIError("unavailable")
