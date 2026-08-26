"""一整条回合走下来是什么样。

这一条串起本模块的两个主轴：**技能按需拉取**（提示词里只有简介，正文靠
`skills.load` 拉）与**客户端工具交出去**（改画布的活不在服务端干）。
两者任一断了，助手都还能「跑完」——只是它做的事与用户看到的对不上，
所以要有一条从头走到尾的用例把顺序钉住。
"""

from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
)

from ai_assistant.apps.chat.services.prompt import build_system_prompt
from ai_assistant.apps.chat.services.server_tools import ServerTools
from ai_assistant.apps.chat.services.tool_specs import specs_named
from ai_assistant.apps.chat.services.turn import TurnDeps, run_turn
from ai_assistant.apps.chat.skills import find_skill
from ai_assistant.llm import GuardedModel
from ai_assistant.llm.provider import ModelChoice
from lib.resilience import CircuitBreaker
from unit.llm_fakes import ScriptedChat, tool_call

SURFACE = "dashboard-editor"
TOOLS = ("skills.load", "points.search", "dashboard.write_binding")


def _asks(tool: str, call_id: str, /, **arguments: Any) -> AIMessage:
    return AIMessage(
        content="", tool_calls=[tool_call(tool, call_id, **arguments)]
    )


def _deps(model: BaseChatModel) -> TurnDeps:
    async def source(_choice: ModelChoice) -> BaseChatModel:
        return model

    return TurnDeps(
        model=GuardedModel(source=source, breaker=CircuitBreaker(name="model")),
        specs=specs_named(TOOLS),
        run_tool=ServerTools(),
    )


def _opening() -> list[BaseMessage]:
    return [
        SystemMessage(content=build_system_prompt(SURFACE)),
        HumanMessage(content="把 1 号机组的出口温度绑到那个数值卡上"),
    ]


async def test_the_model_pulls_the_skill_before_it_acts() -> None:
    model = ScriptedChat(
        script=[
            _asks("skills.load", "s1", name="dashboard-binding"),
            _asks(
                "dashboard.write_binding",
                "w1",
                node_id="n1",
                field_key="itemValues[0].value",
                node_key="src:K1_TMT_HOT_T_PI",
            ),
        ]
    )
    outcome = await run_turn(_deps(model), _opening())

    # 第二轮模型看到的消息里，必须已经有技能正文
    second_round = model.seen[1]
    body = "\n".join(str(message.content) for message in second_round)
    assert "## 工作顺序" in body

    # 而回合停在了客户端工具上，没有替用户改任何东西
    assert outcome.is_waiting is True
    assert outcome.pending[0].name == "dashboard.write_binding"


async def test_the_pulled_body_is_the_one_on_disk() -> None:
    model = ScriptedChat(
        script=[
            _asks("skills.load", "s1", name="dashboard-binding"),
            AIMessage(content="看完了"),
        ]
    )
    await run_turn(_deps(model), _opening())

    skill = find_skill("dashboard-binding")
    assert skill is not None
    body = "\n".join(str(m.content) for m in model.seen[1])
    # 正文里那句最要紧的告诫必须原样到达模型
    assert "不许瞎绑" in skill.instructions()
    assert "不许瞎绑" in body


async def test_the_steps_read_as_a_story_the_user_can_follow() -> None:
    model = ScriptedChat(
        script=[
            _asks("skills.load", "s1", name="dashboard-binding"),
            _asks("points.search", "p1", keyword="出口温度"),
            AIMessage(content="没找到，换个词试试"),
        ]
    )
    outcome = await run_turn(_deps(model), _opening())

    # 界面上逐条渲染的就是这一串
    assert [(step.kind, step.name) for step in outcome.steps] == [
        ("model", "model"),
        ("server_tool", "skills.load"),
        ("model", "model"),
        ("server_tool", "points.search"),
        ("model", "model"),
    ]


async def test_an_unknown_tool_does_not_end_the_turn() -> None:
    model = ScriptedChat(
        script=[
            _asks("points.search", "p1", keyword="温度"),
            AIMessage(content="那个工具没有，我换一个说法"),
        ]
    )
    outcome = await run_turn(_deps(model), _opening())

    # points.search 眼下没有实现，分派器会抛；模型拿到「失败了」之后继续往下走
    failed = [step for step in outcome.steps if step.state == "failed"]
    assert len(failed) == 1
    assert outcome.reply == "那个工具没有，我换一个说法"
