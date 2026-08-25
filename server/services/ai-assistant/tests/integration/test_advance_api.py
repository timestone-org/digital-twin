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
from unit.llm_fakes import ScriptedChat, tool_call

from ai_assistant.apps.chat.catalog import ASSISTANT_USE
from ai_assistant.apps.chat.deps import get_advance_deps
from ai_assistant.apps.chat.services.advance_service import AdvanceDeps
from ai_assistant.apps.chat.services.server_tools import ServerTools
from ai_assistant.llm import GuardedModel
from ai_assistant.llm.provider import ModelKind
from integration.conftest import DbStack
from lib.resilience import CircuitBreaker

pytestmark = pytest.mark.requires_postgres

SESSIONS_URL = "/api/v1/assistant/sessions"


def _asks(tool: str, call_id: str, /, **arguments: Any) -> AIMessage:
    return AIMessage(
        content="", tool_calls=[tool_call(tool, call_id, **arguments)]
    )


def _install(stack: DbStack, model: BaseChatModel) -> None:
    """把假模型与用例那条连接装进推进依赖。

    Args: stack, model。
    """

    def source(_kind: ModelKind) -> BaseChatModel:
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

    assert [name for name, _ in events] == ["step", "turn.done"]
    assert events[-1][1]["reply"] == "你好"


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
