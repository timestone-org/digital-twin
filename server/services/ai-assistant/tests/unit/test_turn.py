"""回合编排：模型 ↔ 工具，直到给出答复或停下来等浏览器。

**这个文件守的是 ADR-0023 的第一条决策**：改画布的工具不在服务端执行。
走到客户端工具时回合必须就地停住并把待办交出去，而不是自己想办法跑掉它。

同时守两条容易写漏的：混合批次里服务端那几个要先跑完（否则浏览器回来时模型
缺半批结果），以及服务端工具失败也必须回一条工具消息（不回的话模型那次调用
永远没有答复，下一轮请求会被端点判成不合法）。
"""

from typing import Any

import pytest
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage

from ai_assistant.llm import GuardedModel
from ai_assistant.llm.ports import ModelChoice
from lib.resilience import CircuitBreaker
from llmcore.tools.shapes import ToolSpec
from llmcore.turn.loop import (
    TurnDeps,
    run_turn,
    stream_turn,
)
from llmcore.turn.types import (
    TurnDelta,
    TurnOutcome,
    TurnStep,
)
from unit.llm_fakes import ScriptedChat, tool_call

SERVER_TOOL = ToolSpec(
    name="points.search",
    description="找点位",
    parameters={"type": "object", "properties": {}},
    runs_on="server",
)
CLIENT_TOOL = ToolSpec(
    name="dashboard.write_binding",
    description="写绑定",
    parameters={"type": "object", "properties": {}},
    runs_on="client",
)


class RecordingRunner:
    """记下被调过哪些服务端工具，可选地抛错。"""

    def __init__(self, result: Any = "ok", error: Exception | None = None):
        self.result = result
        self.error = error
        self.seen: list[tuple[str, dict[str, Any]]] = []

    async def __call__(self, name: str, arguments: dict[str, Any]) -> Any:
        self.seen.append((name, arguments))
        if self.error is not None:
            raise self.error
        return self.result


def _deps(
    model: BaseChatModel,
    runner: RecordingRunner,
    specs: tuple[ToolSpec, ...] = (SERVER_TOOL, CLIENT_TOOL),
) -> TurnDeps:
    async def source(_choice: ModelChoice) -> BaseChatModel:
        return model

    return TurnDeps(
        model=GuardedModel(source=source, breaker=CircuitBreaker(name="model")),
        specs=specs,
        run_tool=runner,
    )


def _ask() -> list[BaseMessage]:
    return [HumanMessage(content="帮我绑一下 1 号机组的温度")]


def _asks(tool: str, call_id: str, /, **arguments: Any) -> AIMessage:
    return AIMessage(
        content="", tool_calls=[tool_call(tool, call_id, **arguments)]
    )


async def test_a_plain_answer_ends_the_turn() -> None:
    runner = RecordingRunner()
    model = ScriptedChat(reply=AIMessage(content="这是答复"))
    outcome = await run_turn(_deps(model, runner), _ask())

    assert outcome.reply == "这是答复"
    assert outcome.is_waiting is False
    assert runner.seen == []


async def test_a_server_tool_runs_here_and_the_turn_continues() -> None:
    runner = RecordingRunner(result={"points": []})
    model = ScriptedChat(
        script=[
            _asks("points.search", "c1", keyword="温度"),
            AIMessage(content="没找到合适的点位"),
        ]
    )
    outcome = await run_turn(_deps(model, runner), _ask())

    assert runner.seen == [("points.search", {"keyword": "温度"})]
    assert outcome.reply == "没找到合适的点位"
    assert outcome.is_waiting is False


async def test_a_client_tool_stops_the_turn_and_hands_it_over() -> None:
    runner = RecordingRunner()
    model = ScriptedChat(
        script=[_asks("dashboard.write_binding", "c9", node_id="n1")]
    )
    outcome = await run_turn(_deps(model, runner), _ask())

    # 改画布的工具不在服务端执行，回合必须就地停住（ADR-0023）
    assert outcome.is_waiting is True
    assert [call.name for call in outcome.pending] == [
        "dashboard.write_binding"
    ]
    assert outcome.pending[0].call_id == "c9"
    assert outcome.pending[0].arguments == {"node_id": "n1"}
    assert runner.seen == []


async def test_a_mixed_batch_runs_the_server_side_before_handing_over() -> None:
    runner = RecordingRunner(result={"points": ["a"]})
    both = AIMessage(
        content="",
        tool_calls=[
            tool_call("points.search", "c1", keyword="温度"),
            tool_call("dashboard.write_binding", "c2", node_id="n1"),
        ],
    )
    model = ScriptedChat(script=[both])
    outcome = await run_turn(_deps(model, runner), _ask())

    # 服务端那几个先跑完，否则浏览器回来时模型手上缺半批结果
    assert runner.seen == [("points.search", {"keyword": "温度"})]
    assert [call.name for call in outcome.pending] == [
        "dashboard.write_binding"
    ]


async def test_a_failing_server_tool_still_answers_the_model() -> None:
    runner = RecordingRunner(error=RuntimeError("库连不上"))
    model = ScriptedChat(
        script=[
            _asks("points.search", "c1", keyword="温度"),
            AIMessage(content="检索没成功，换个说法试试"),
        ]
    )
    outcome = await run_turn(_deps(model, runner), _ask())

    # 不回工具消息的话，那次调用永远没有答复，下一轮会被端点判成不合法
    tool_messages = [
        message
        for message in outcome.messages
        if getattr(message, "type", "") == "tool"
    ]
    assert len(tool_messages) == 1
    assert "失败" in str(tool_messages[0].content)
    assert outcome.reply == "检索没成功，换个说法试试"


async def test_a_failing_server_tool_is_recorded_as_a_failed_step() -> None:
    runner = RecordingRunner(error=RuntimeError("库连不上"))
    model = ScriptedChat(
        script=[
            _asks("points.search", "c1", keyword="温度"),
            AIMessage(content="算了"),
        ]
    )
    outcome = await run_turn(_deps(model, runner), _ask())

    failed = [step for step in outcome.steps if step.state == "failed"]
    assert len(failed) == 1
    assert failed[0].kind == "server_tool"
    assert failed[0].name == "points.search"
    assert failed[0].error is not None


async def test_every_step_is_recorded_in_order() -> None:
    runner = RecordingRunner()
    model = ScriptedChat(
        script=[
            _asks("points.search", "c1", keyword="温度"),
            AIMessage(content="好了"),
        ]
    )
    outcome = await run_turn(_deps(model, runner), _ask())

    # 界面上「AI 做了哪一步」逐条渲染的就是这个序列
    assert [step.kind for step in outcome.steps] == [
        "model",
        "server_tool",
        "model",
    ]


async def test_the_outcome_only_carries_messages_added_this_turn() -> None:
    runner = RecordingRunner()
    model = ScriptedChat(reply=AIMessage(content="答复"))
    seeded = _ask()
    outcome = await run_turn(_deps(model, runner), seeded)

    # 喂进去的那条用户消息不该再被当成本回合的新增落一遍库
    assert all(
        not isinstance(message, HumanMessage) for message in outcome.messages
    )


async def test_a_tool_the_model_invents_is_reported_back_not_executed() -> None:
    runner = RecordingRunner()
    model = ScriptedChat(
        script=[_asks("nothing.like_this", "c1"), AIMessage(content="换一个")]
    )
    outcome = await run_turn(_deps(model, runner), _ask())

    # 认不出的名字既不能就地跑，也不能静默丢——丢了那次调用就没有答复
    assert runner.seen == [("nothing.like_this", {})]
    assert outcome.reply == "换一个"


@pytest.mark.parametrize("kind", ["chat", "vision"])
async def test_both_model_kinds_run_the_same_loop(kind: str) -> None:
    runner = RecordingRunner()
    model = ScriptedChat(reply=AIMessage(content="好"))
    deps = _deps(model, runner)
    outcome = await run_turn(
        TurnDeps(
            model=deps.model,
            specs=deps.specs,
            run_tool=deps.run_tool,
            choice=ModelChoice(kind="vision" if kind == "vision" else "chat"),
        ),
        _ask(),
    )
    assert outcome.reply == "好"


async def test_the_streaming_variant_yields_each_step_as_it_happens() -> None:
    runner = RecordingRunner()
    model = ScriptedChat(
        script=[
            _asks("points.search", "c1", keyword="温度"),
            AIMessage(content="好了"),
        ]
    )
    seen: list[str] = []
    outcome: TurnOutcome | None = None
    async for item in stream_turn(_deps(model, runner), _ask()):
        if isinstance(item, TurnOutcome):
            outcome = item
        elif isinstance(item, TurnStep):
            seen.append(item.kind)

    # 等回合整个跑完再一次性推的话，一次绑点要转十几秒的圈
    assert seen == ["model", "server_tool", "model"]
    assert outcome is not None
    assert outcome.reply == "好了"


async def test_the_streaming_variant_agrees_with_the_blocking_one() -> None:
    runner = RecordingRunner()
    model = ScriptedChat(
        script=[_asks("dashboard.write_binding", "c9", node_id="n1")]
    )
    streamed: TurnOutcome | None = None
    async for item in stream_turn(_deps(model, runner), _ask()):
        if isinstance(item, TurnOutcome):
            streamed = item

    other = ScriptedChat(
        script=[_asks("dashboard.write_binding", "c9", node_id="n1")]
    )
    blocking = await run_turn(_deps(other, RecordingRunner()), _ask())

    # 两条路给出的待办必须一样，否则「界面看到的」与「落库的」会分叉
    assert streamed is not None
    assert [call.name for call in streamed.pending] == [
        call.name for call in blocking.pending
    ]
    assert streamed.is_waiting == blocking.is_waiting


async def test_the_model_text_arrives_as_deltas_before_the_turn_ends() -> None:
    """模型说的话必须在回合结束**之前**就一块块出来。

    ⚠ 只在 `turn.done` 里给的话，用户在模型作答的十几秒里看到的是一片空白，
    而助手其实一直在说。
    """
    model = ScriptedChat(reply=AIMessage(content="已经绑好了"))
    said: list[str] = []
    ended = False
    async for item in stream_turn(_deps(model, RecordingRunner()), _ask()):
        if isinstance(item, TurnDelta):
            assert not ended, "增量不许晚于回合结束"
            said.append(item.text)
        if isinstance(item, TurnOutcome):
            ended = True

    assert "".join(said) == "已经绑好了"


async def test_a_tool_only_reply_produces_no_text_delta() -> None:
    """只要工具、不说话的那一轮不许吐增量。

    ⚠ 吐一条空的出去，界面上就是一个空气泡——而它出现在「正在查点位」
    这一步之前，读起来像助手答非所问。
    """
    model = ScriptedChat(
        script=[
            _asks("points.search", "c1", keyword="温度"),
            AIMessage(content="查到了"),
        ]
    )
    said = [
        item.text
        async for item in stream_turn(_deps(model, RecordingRunner()), _ask())
        if isinstance(item, TurnDelta)
    ]

    assert said == ["查到了"]
