"""边跑边吐：模型说的每一小块、走完的每一步，最后一个结果。

⚠ 增量与步骤走**同一条队列**。各走各的话，两侧的先后就由调度器决定，而界面上
会出现「先看见结论、再看见推导」这种读起来像是乱序的东西——这一条由这里的
顺序断言守。
"""

from typing import Any

import pytest
from langchain_core.messages import AIMessage
from unit.fakes import ScriptedResponder, tool_call

from llmcore.tools.shapes import ToolSpec, object_schema
from llmcore.turn import TurnDeps, stream_turn
from llmcore.turn.types import TurnDelta, TurnOutcome, TurnStep

SERVER_TOOL = ToolSpec(
    name="kb.search",
    description="检索",
    parameters=object_schema({}, []),
    runs_on="server",
)


async def _ok(name: str, arguments: dict[str, Any]) -> object:
    del name, arguments
    return {"hits": 1}


def _deps(responder: ScriptedResponder) -> TurnDeps:
    return TurnDeps(model=responder, specs=(SERVER_TOOL,), run_tool=_ok)


async def _drain(deps: TurnDeps) -> list[object]:
    return [event async for event in stream_turn(deps, [])]


async def test_a_plain_answer_streams_its_text_then_the_outcome() -> None:
    responder = ScriptedResponder([AIMessage(content="就这些")])

    got = await _drain(_deps(responder))

    assert isinstance(got[-1], TurnOutcome)
    assert any(isinstance(one, TurnDelta) for one in got)


async def test_the_outcome_is_always_the_last_thing_out() -> None:
    """⚠ 结果先于步骤到达的话，界面会先画结论再画推导。"""
    responder = ScriptedResponder(
        [
            AIMessage(
                content="", tool_calls=[tool_call("kb.search", {}, "c1")]
            ),
            AIMessage(content="查到了"),
        ]
    )

    got = await _drain(_deps(responder))

    assert isinstance(got[-1], TurnOutcome)
    assert not any(isinstance(one, TurnOutcome) for one in got[:-1])


async def test_steps_reach_the_stream_while_the_turn_is_still_running() -> None:
    responder = ScriptedResponder(
        [
            AIMessage(
                content="", tool_calls=[tool_call("kb.search", {}, "c1")]
            ),
            AIMessage(content="查到了"),
        ]
    )

    got = await _drain(_deps(responder))

    names = [one.name for one in got if isinstance(one, TurnStep)]
    assert "kb.search" in names


async def test_a_blow_up_inside_the_turn_reaches_the_consumer() -> None:
    """⚠ 吞掉的话，界面会停在一个永远转下去的圈上。"""
    responder = ScriptedResponder([])

    with pytest.raises(AssertionError):
        await _drain(_deps(responder))


async def test_letting_go_half_way_cancels_the_work() -> None:
    """⚠ 不掐掉的话图会一直跑到自己结束，而它每一步都在花模型的钱。"""
    responder = ScriptedResponder(
        [
            AIMessage(
                content="", tool_calls=[tool_call("kb.search", {}, "c1")]
            ),
            AIMessage(content="查到了"),
        ]
    )

    seen = 0
    async for _event in stream_turn(_deps(responder), []):
        seen += 1
        break

    assert seen == 1
