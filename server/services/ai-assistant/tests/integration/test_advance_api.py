"""推进一个回合：事件流从头到尾走一遍，并且真的落库。

**这一条是整个模块的验收点**：技能按需拉取、服务端工具就地跑、客户端工具停下来
等浏览器、每一步都推出去、回合结束前落库——五件事在同一次请求里全走一遍。
少了任何一件助手都还能「跑完」，只是它做的事与用户看到的、与库里存下的对不上。
"""

import json
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import httpx
import pytest
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage
from sqlalchemy.ext.asyncio import AsyncSession
from unit.llm_fakes import ScriptedChat, StreamingChat, tool_call

from ai_assistant.apps.chat.catalog import ASSISTANT_USE
from ai_assistant.apps.chat.deps import get_advance_deps
from ai_assistant.apps.chat.services.advance_service import AdvanceDeps
from ai_assistant.apps.chat.services.memory import NullSummarizer
from ai_assistant.apps.chat.services.perception import vision
from ai_assistant.apps.chat.services.tools.providers.server import ServerTools
from ai_assistant.llm import GuardedModel
from ai_assistant.llm.ports import ModelChoice, ModelKind
from integration.conftest import DbStack
from lib.resilience import CircuitBreaker

pytestmark = pytest.mark.requires_postgres

SESSIONS_URL = "/api/v1/assistant/sessions"
PNG = "data:image/png;base64,iVBORw0KGgo="


def _asks(tool: str, call_id: str, /, **arguments: Any) -> AIMessage:
    return AIMessage(
        content="", tool_calls=[tool_call(tool, call_id, **arguments)]
    )


def _install(
    stack: DbStack, model: BaseChatModel, asked: list[ModelKind] | None = None
) -> None:
    """把假模型与用例那条连接装进推进依赖。

    Args: stack, model, asked（记下每次要的是哪一档模型）。
    """

    async def source(choice: ModelChoice) -> BaseChatModel:
        if asked is not None:
            asked.append(choice.kind)
        return model

    @asynccontextmanager
    async def sessions() -> AsyncIterator[AsyncSession]:
        async with stack.sessions() as session:
            yield session
            await session.commit()

    stack.app.dependency_overrides[get_advance_deps] = lambda: AdvanceDeps(
        sessions=sessions,
        model=GuardedModel(source=source, breaker=CircuitBreaker(name="model")),
        server_tools=ServerTools(),
        # ⚠ 这里装的是「不折」那一路：折叠会多打一次模型，而这些用例数的是
        # 模型被调了几次、按哪一档调的
        summarizer=lambda _profile: NullSummarizer(),
    )


async def _new_session(client: httpx.AsyncClient) -> str:
    response = await client.post(
        SESSIONS_URL,
        json={"surface_kind": "dashboard-editor", "title": "绑点"},
    )
    assert response.status_code == 201
    return str(response.json()["data"]["id"])


def _events(body: str) -> list[tuple[str, dict[str, Any]]]:
    """把事件流拆成 `(事件名, 载荷)`。

    Args: body。
    """
    found: list[tuple[str, dict[str, Any]]] = []
    for chunk in body.strip().split("\n\n"):
        lines = chunk.splitlines()
        name = next(
            x.removeprefix("event: ") for x in lines if x.startswith("event: ")
        )
        data = next(
            x.removeprefix("data: ") for x in lines if x.startswith("data: ")
        )
        found.append((name, json.loads(data)))
    return found


async def _advance(
    client: httpx.AsyncClient, session_id: str, **body: Any
) -> list[tuple[str, dict[str, Any]]]:
    response = await client.post(
        f"{SESSIONS_URL}/{session_id}:advance",
        json={"surface_kind": "dashboard-editor", **body},
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    return _events(response.text)


async def test_a_plain_answer_streams_a_step_then_done(
    db_stack: DbStack,
) -> None:
    _install(db_stack, ScriptedChat(reply=AIMessage(content="你好")))
    session_id = await _new_session(db_stack.client)

    events = await _advance(db_stack.client, session_id, user_text="在吗")

    # ⚠ 增量排在步骤之前：模型是先说出来、这一步才算走完的
    assert [name for name, _ in events] == [
        "message.delta",
        "step",
        "turn.done",
    ]
    assert events[0][1] == {"channel": "text", "text": "你好"}
    assert events[-1][1]["reply"] == "你好"


async def test_the_snapshot_of_the_page_reaches_the_model(
    db_stack: DbStack,
) -> None:
    """工作面快照要真的进到模型看得见的那一段，而且在**最后一条**上。

    ⚠ 进不去的话，用户说「把**这个**模块的标题改掉」时，「这个」在模型手里
    没有指代——它只能反问，或者挑一个看着像的画布节点动手。

    ⚠ 不许回到系统提示词里：那一段是端点前缀缓存唯一能命中的地方，而快照每轮
    都变，塞进去等于把它后面的工具声明与整段历史一起作废（ADR-0025）。
    """
    model = ScriptedChat(reply=AIMessage(content="好"))
    _install(db_stack, model)
    session_id = await _new_session(db_stack.client)

    await _advance(
        db_stack.client,
        session_id,
        user_text="把这个模块的标题改成机组温度",
        surface_context={
            "selected_id": "n7",
            "selected": {"id": "n7", "module_type": "info-card"},
        },
    )

    seen = model.seen[0]
    state = str(seen[-1].content)
    assert "n7" in state
    assert "info-card" in state
    assert "n7" not in str(seen[0].content)


async def test_an_oversized_snapshot_is_refused_up_front(
    db_stack: DbStack,
) -> None:
    """快照大到能挤掉提示词时当场拒。

    ⚠ 就地截断出来的是一段不合法的 JSON，而模型读到一半会当成
    「这一屏就这么多」，然后对着半屏画布下结论。
    """
    _install(db_stack, ScriptedChat(reply=AIMessage(content="好")))
    session_id = await _new_session(db_stack.client)

    response = await db_stack.client.post(
        f"{SESSIONS_URL}/{session_id}:advance",
        json={
            "surface_kind": "dashboard-editor",
            "user_text": "看看",
            "surface_context": {"nodes": ["n" * 200 for _ in range(400)]},
        },
    )

    assert response.status_code == 400


async def test_the_thinking_is_streamed_but_never_stored(
    db_stack: DbStack,
) -> None:
    """想的过程推得出去，但一个字都不许落库。

    ⚠ 落了的话，这个会话每重放一次就把它再喂给模型一遍，
    上下文与账单一起翻倍——而模型早就把结论写进正文了。
    """
    _install(
        db_stack,
        StreamingChat(parts=[("绑好了", "先查点位，再逐个写进去")]),
    )
    session_id = await _new_session(db_stack.client)

    events = await _advance(db_stack.client, session_id, user_text="帮我绑点")

    thoughts = [
        body["text"]
        for name, body in events
        if name == "message.delta" and body["channel"] == "reasoning"
    ]
    assert thoughts == ["先查点位，再逐个写进去"]

    detail = await db_stack.client.get(f"{SESSIONS_URL}/{session_id}")
    stored = json.dumps(detail.json()["data"]["messages"], ensure_ascii=False)
    assert "先查点位" not in stored
    assert "绑好了" in stored


async def test_the_turn_is_persisted_with_its_steps(
    db_stack: DbStack,
) -> None:
    _install(db_stack, ScriptedChat(reply=AIMessage(content="你好")))
    session_id = await _new_session(db_stack.client)
    await _advance(db_stack.client, session_id, user_text="在吗")

    detail = await db_stack.client.get(f"{SESSIONS_URL}/{session_id}")
    messages = detail.json()["data"]["messages"]
    # 用户那一条与助手那一条都要在，且步骤挂在助手那条上
    assert [m["role"] for m in messages] == ["user", "assistant"]
    assert len(messages[-1]["steps"]) == 1


async def test_a_client_tool_stops_the_stream_and_is_recorded(
    db_stack: DbStack,
) -> None:
    _install(
        db_stack,
        ScriptedChat(
            script=[
                _asks("skills.load", "s1", name="dashboard-binding"),
                _asks(
                    "dashboard.write_binding",
                    "w1",
                    node_id="n1",
                    field_key="itemValues[0].value",
                    node_key="src:K1_TT02_PI",
                ),
            ]
        ),
    )
    session_id = await _new_session(db_stack.client)

    events = await _advance(db_stack.client, session_id, user_text="帮我绑点")

    names = [name for name, _ in events]
    assert names[-1] == "client_tool.request"
    assert "step" in names
    calls = events[-1][1]["calls"]
    assert calls[0]["name"] == "dashboard.write_binding"
    assert calls[0]["call_id"] == "w1"

    detail = await db_stack.client.get(f"{SESSIONS_URL}/{session_id}")
    steps = detail.json()["data"]["messages"][-1]["steps"]
    waiting = [s for s in steps if s["state"] == "awaiting_client"]
    # 浏览器一定会带着结果回来，它要能在库里找到自己接的是哪一步
    assert len(waiting) == 1


async def test_the_browser_can_hand_the_result_back(
    db_stack: DbStack,
) -> None:
    _install(
        db_stack,
        ScriptedChat(
            script=[
                _asks("dashboard.write_binding", "w1", node_id="n1"),
                AIMessage(content="绑好了，保存之后才会有数值"),
            ]
        ),
    )
    session_id = await _new_session(db_stack.client)
    await _advance(db_stack.client, session_id, user_text="帮我绑点")

    events = await _advance(
        db_stack.client,
        session_id,
        tool_results=[{"call_id": "w1", "output": {"ok": True}}],
    )

    assert events[-1][0] == "turn.done"
    assert "保存之后" in events[-1][1]["reply"]


async def test_sending_both_a_message_and_results_is_refused(
    db_stack: DbStack,
) -> None:
    _install(db_stack, ScriptedChat())
    session_id = await _new_session(db_stack.client)

    response = await db_stack.client.post(
        f"{SESSIONS_URL}/{session_id}:advance",
        json={
            "surface_kind": "dashboard-editor",
            "user_text": "在吗",
            "tool_results": [{"call_id": "w1", "output": 1}],
        },
    )
    # 同时给的话，模型会把「一句新要求」与「上一轮的工具结果」揉成一件事做。
    # ⚠ 本仓把校验失败映射成 400 + 40001，不是 FastAPI 默认的 422
    assert response.status_code == 400
    assert response.json()["code"] == 40001


async def test_another_plain_callers_session_cannot_be_advanced(
    db_stack: DbStack, sign: Any
) -> None:
    _install(db_stack, ScriptedChat())
    session_id = await _new_session(db_stack.client)

    # ⚠ 必须签一个**只有 use 没有 manage** 的身份：默认那份带 manage，
    # 而持它的人本来就看得见所有人的会话
    response = await db_stack.client.post(
        f"{SESSIONS_URL}/{session_id}:advance",
        json={"surface_kind": "dashboard-editor", "user_text": "在吗"},
        headers=sign([ASSISTANT_USE]),
    )
    assert response.status_code == 404


async def test_an_unknown_session_is_missing(db_stack: DbStack) -> None:
    _install(db_stack, ScriptedChat())
    response = await db_stack.client.post(
        f"{SESSIONS_URL}/{uuid.uuid4()}:advance",
        json={"surface_kind": "dashboard-editor", "user_text": "在吗"},
    )
    assert response.status_code == 404


async def test_a_screenshot_goes_to_the_vision_model_and_stays_out_of_the_db(
    db_stack: DbStack,
) -> None:
    asked: list[ModelKind] = []
    _install(
        db_stack,
        ScriptedChat(
            script=[
                _asks("dashboard.capture", "p1"),
                AIMessage(content="左上角那个卡片比右边三个矮 12 像素"),
            ]
        ),
        asked,
    )
    session_id = await _new_session(db_stack.client)
    await _advance(db_stack.client, session_id, user_text="看看我这屏怎么样")

    events = await _advance(
        db_stack.client,
        session_id,
        tool_results=[{"call_id": "p1", "output": PNG}],
    )

    assert events[-1][0] == "turn.done"
    # 带图那一轮才走视觉档：整个会话都走的话，之后每句闲聊都按视觉计费
    assert asked[-1] == "vision"

    detail = await db_stack.client.get(f"{SESSIONS_URL}/{session_id}")
    stored = json.dumps(detail.json()["data"], ensure_ascii=False)
    # 几兆字节的 base64 存一次、每次重放再喂一遍，上下文与账单一起翻倍
    assert PNG not in stored
    assert vision.PLACEHOLDER in stored


async def test_writing_a_plan_streams_a_snapshot_and_persists_it(
    db_stack: DbStack,
) -> None:
    """计划全链路：`plan.write` 落库、`plan` 事件紧跟那一步、详情接口带得出来。

    ⚠ 快照事件必须紧跟在写计划那一步后面：前端的清单与步骤是同一条时间线，
    错开的话界面上是「步骤说写了计划，清单却还是旧的」。
    """
    model = ScriptedChat(
        script=[
            _asks(
                "plan.write",
                "c-plan",
                title="绑完整屏",
                items=[
                    {"title": "读画布", "status": "in_progress"},
                    {"title": "绑温度槽"},
                ],
            )
        ],
        reply=AIMessage(content="计划立好了"),
    )
    _install(db_stack, model)
    session_id = await _new_session(db_stack.client)

    events = await _advance(db_stack.client, session_id, user_text="把整屏绑好")

    names = [name for name, _ in events]
    step_at = names.index("step", names.index("step") + 1)  # 第二步是工具步
    assert names[step_at + 1] == "plan"
    plan = next(data for name, data in events if name == "plan")["plan"]
    assert plan["state"] == "active"
    assert [one["status"] for one in plan["items"]] == [
        "in_progress",
        "pending",
    ]

    detail = await db_stack.client.get(f"{SESSIONS_URL}/{session_id}")
    assert detail.status_code == 200
    stored = detail.json()["data"]["plan_json"]
    assert stored is not None
    assert stored["title"] == "绑完整屏"


async def test_the_plan_reaches_the_next_rounds_prompt(
    db_stack: DbStack,
) -> None:
    """上一轮立的计划要出现在下一轮的状态块里，且当前项被点名。

    ⚠ 状态块在**最后一条**，不在系统提示词里——理由同快照那一条（ADR-0025）。
    """
    first = ScriptedChat(
        script=[
            _asks(
                "plan.write",
                "c-plan",
                items=[{"title": "绑温度槽", "status": "in_progress"}],
            )
        ],
        reply=AIMessage(content="开工"),
    )
    _install(db_stack, first)
    session_id = await _new_session(db_stack.client)
    await _advance(db_stack.client, session_id, user_text="绑一下")

    second = ScriptedChat(reply=AIMessage(content="继续"))
    _install(db_stack, second)
    await _advance(db_stack.client, session_id, user_text="继续吧")

    seen = second.seen[0]
    state = str(seen[-1].content)
    assert "## 当前计划" in state
    assert "你正在做第 1 项：**绑温度槽**" in state
    assert "## 当前计划" not in str(seen[0].content)
