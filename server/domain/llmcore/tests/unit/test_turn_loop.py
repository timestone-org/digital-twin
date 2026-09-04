"""回合循环：模型 ↔ 工具，直到给出答复或停下来等浏览器。

这里验的是**与产品无关**的那几条：客户端工具不在服务端跑、工具失败不炸回合、
超大产出要截断且说出来、上限可配。助手那边另有一条把熔断也串进来的用例。
"""

from typing import Any

import pytest
from langchain_core.messages import AIMessage
from unit.fakes import ScriptedResponder, tool_call

from llmcore.tools.shapes import ToolSpec
from llmcore.turn import (
    DEFAULT_MAX_STEPS,
    DEFAULT_MAX_TOOL_RESULT_CHARS,
    ServerToolRunner,
    TurnDeps,
    run_turn,
)

SERVER_TOOL = ToolSpec(
    name="kb.search",
    description="检索",
    parameters={"type": "object", "properties": {}},
    runs_on="server",
)
CLIENT_TOOL = ToolSpec(
    name="user.ask",
    description="反问",
    parameters={"type": "object", "properties": {}},
    runs_on="client",
)


async def _noop(name: str, arguments: dict[str, Any]) -> object:
    del name, arguments
    return {"ok": True}


def _deps(
    responder: ScriptedResponder,
    run_tool: ServerToolRunner = _noop,
    max_steps: int = DEFAULT_MAX_STEPS,
    max_tool_result_chars: int = DEFAULT_MAX_TOOL_RESULT_CHARS,
) -> TurnDeps:
    return TurnDeps(
        model=responder,
        specs=(SERVER_TOOL, CLIENT_TOOL),
        run_tool=run_tool,
        max_steps=max_steps,
        max_tool_result_chars=max_tool_result_chars,
    )


async def test_a_plain_answer_finishes_in_one_step() -> None:
    responder = ScriptedResponder([AIMessage(content="就这些")])

    got = await run_turn(_deps(responder), [])

    assert got.reply == "就这些"
    assert got.pending == ()


async def test_a_server_tool_runs_here_and_the_model_sees_its_output() -> None:
    responder = ScriptedResponder(
        [
            AIMessage(
                content="",
                tool_calls=[tool_call("kb.search", {"q": "锅炉"}, "c1")],
            ),
            AIMessage(content="查到了"),
        ]
    )
    seen: list[tuple[str, dict[str, object]]] = []

    async def run_tool(name: str, arguments: dict[str, Any]) -> object:
        seen.append((name, arguments))
        return {"hits": 1}

    got = await run_turn(_deps(responder, run_tool), [])

    assert seen == [("kb.search", {"q": "锅炉"})]
    assert got.reply == "查到了"


async def test_a_client_tool_stops_the_turn_instead_of_running_here() -> None:
    """⚠ 客户端工具没有服务端实现，在这边跑等于每次都失败。"""
    responder = ScriptedResponder(
        [
            AIMessage(
                content="",
                tool_calls=[
                    tool_call("user.ask", {"question": "哪一个"}, "c1")
                ],
            )
        ]
    )
    ran: list[str] = []

    async def run_tool(name: str, arguments: dict[str, Any]) -> object:
        del arguments
        ran.append(name)
        return None

    got = await run_turn(_deps(responder, run_tool), [])

    assert ran == []
    assert [call.name for call in got.pending] == ["user.ask"]


async def test_a_failing_tool_never_takes_the_whole_turn_down() -> None:
    """⚠ 一个工具坏掉不该炸掉整个回合：模型拿到「失败了」往往能换条路走。"""
    responder = ScriptedResponder(
        [
            AIMessage(
                content="", tool_calls=[tool_call("kb.search", {}, "c1")]
            ),
            AIMessage(content="换个说法再试"),
        ]
    )

    async def boom(name: str, arguments: dict[str, Any]) -> object:
        del name, arguments
        raise RuntimeError("上游 503")

    got = await run_turn(_deps(responder, boom), [])

    assert got.reply == "换个说法再试"
    failed = [step for step in got.steps if step.state == "failed"]
    assert len(failed) == 1
    assert "上游 503" in (failed[0].error or "")


async def test_an_oversized_tool_result_is_clamped_and_says_so() -> None:
    """⚠ 静默截断会让模型把半份结果当成全部。"""
    responder = ScriptedResponder(
        [
            AIMessage(
                content="", tool_calls=[tool_call("kb.search", {}, "c1")]
            ),
            AIMessage(content="好"),
        ]
    )

    async def huge(name: str, arguments: dict[str, Any]) -> object:
        del name, arguments
        return {"body": "长" * 5_000}

    await run_turn(_deps(responder, huge, max_tool_result_chars=200), [])

    fed = responder.asked[-1]
    body = str(fed[-1].content)
    assert len(body) < 1_000
    assert "已截断" in body


async def test_the_step_ceiling_is_configurable() -> None:
    """⚠ 没有上限时，模型与工具可以互相喂到把上下文填满，而每一步都在花钱。"""
    responder = ScriptedResponder(
        [
            AIMessage(
                content="", tool_calls=[tool_call("kb.search", {}, f"c{i}")]
            )
            for i in range(10)
        ]
    )

    with pytest.raises(Exception):  # noqa: B017,PT011
        await run_turn(_deps(responder, max_steps=2), [])


async def test_a_reply_split_into_content_blocks_is_still_a_reply() -> None:
    """⚠ 带思考摘要的那几路（Responses 方言）把摘要与正文分别放进
    `reasoning` 与 `text` 块里，`content` 于是是**一串块**而不是一个字符串。

    当成字符串取的表现极难认：回合看着答完了，答案也确实流到了界面上（增量
    是另一条路），只有**依赖 `reply` 的东西**静默失灵——知识库那边靠它扫角标
    出引用，于是引用一条都不出，而日志里没有任何异常。
    """
    responder = ScriptedResponder(
        [
            AIMessage(
                content=[
                    {
                        "type": "reasoning",
                        "summary": [
                            {"type": "summary_text", "text": "先查一下库"}
                        ],
                    },
                    {"type": "text", "text": "上限是 65 ℃。①"},
                ]
            )
        ]
    )

    got = await run_turn(_deps(responder), [])

    assert got.reply == "上限是 65 ℃。①"


async def test_a_block_that_is_not_text_never_reaches_the_reply() -> None:
    """⚠ 认不出的块当没有，而不是 `str()` 它：那会把一段 Python 字面量摆进
    用户的对话框，而且会让扫角标的正则在里面撞出假角标。"""
    responder = ScriptedResponder(
        [
            AIMessage(
                content=[
                    {"type": "image_url", "image_url": {"url": "data:…"}},
                    {"type": "text", "text": "看图说话"},
                ]
            )
        ]
    )

    got = await run_turn(_deps(responder), [])

    assert got.reply == "看图说话"


async def test_a_tool_call_written_as_prose_is_actually_run() -> None:
    """⚠ 小模型（与某些兼容网关）会把调用照训练时的写法打进正文。不捡的表现是
    双重失败：那一步没人执行，而那坨尖括号原样成了给用户的答案。"""
    written = AIMessage(
        content=(
            "先看看原文。\n\n<tool_call>\n<function=kb.search>\n"
            "<parameter=query>冷却水</parameter>\n</function>\n</tool_call>"
        )
    )
    responder = ScriptedResponder([written, AIMessage(content="上限 65 ℃")])
    seen: list[dict[str, Any]] = []

    async def spy(name: str, arguments: dict[str, Any]) -> object:
        del name
        seen.append(arguments)
        return {"hits": []}

    got = await run_turn(_deps(responder, spy), [])

    assert seen == [{"query": "冷却水"}]
    assert got.reply == "上限 65 ℃"


async def test_the_salvaged_block_never_reaches_the_stored_message() -> None:
    """摘不掉的话它会落库、进标题、进下一轮的上下文，而用户看到的是一坨 XML。"""
    written = AIMessage(
        content=(
            "先看看原文。<tool_call><function=kb.search>"
            "<parameter=query>冷却水</parameter></function></tool_call>"
        )
    )
    responder = ScriptedResponder([written, AIMessage(content="好了")])

    got = await run_turn(_deps(responder), [])

    stored = "".join(str(one.content) for one in got.messages)
    assert "<tool_call>" not in stored
    assert "先看看原文。" in stored


async def test_a_real_tool_call_is_never_second_guessed() -> None:
    """⚠ 有原生调用还去翻正文的话，模型复述自己刚发的那次调用会被执行两遍。"""
    both = AIMessage(
        content=(
            "我调了 <tool_call><function=kb.search>"
            "<parameter=query>复述</parameter></function></tool_call>"
        ),
        tool_calls=[tool_call("kb.search", {"query": "真的那次"}, "c1")],
    )
    responder = ScriptedResponder([both, AIMessage(content="好了")])
    seen: list[dict[str, Any]] = []

    async def spy(name: str, arguments: dict[str, Any]) -> object:
        del name
        seen.append(arguments)
        return {}

    await run_turn(_deps(responder, spy), [])

    assert seen == [{"query": "真的那次"}]
