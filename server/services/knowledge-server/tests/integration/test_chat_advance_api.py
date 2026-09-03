"""推进一个回合：事件流从头到尾走一遍，并且真的落库。

**这一条是整个对话面的验收点**：知识库工具就地跑、反问停下来等浏览器、
每一步都推出去、回合结束前落库、回填之后接着跑——在同一次请求里全走一遍。
"""

import json
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import httpx
import pytest
from integration.conftest import DbStack
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.chat.deps import get_advance_deps
from knowledge_server.apps.chat.services.advance_service import AdvanceDeps
from knowledge_server.apps.chat.services.scope import BaseScope
from knowledge_server.apps.chat.services.tools import ToolDeps, build_registry
from knowledge_server.apps.chat.services.tools.client import ASK_TOOL
from knowledge_server.settings import API_PREFIX
from lib.resilience import CircuitBreaker
from llmcore import ModelChoice
from llmcore.guard import GuardedModel
from llmcore.memory import NullSummarizer
from llmcore.testing import ScriptedChat, StreamingChat, asks
from llmcore.tools.registry import ToolRegistry

pytestmark = pytest.mark.requires_postgres

URL = f"{API_PREFIX}/chat-sessions"


def _install(stack: DbStack, model: BaseChatModel) -> None:
    """把假模型与用例那条连接装进推进依赖。

    Args: stack, model。
    """

    async def source(_choice: ModelChoice) -> BaseChatModel:
        return model

    @asynccontextmanager
    async def sessions() -> AsyncIterator[AsyncSession]:
        async with stack.sessions() as session:
            yield session
            await session.commit()

    def tools(scope: BaseScope) -> ToolRegistry:
        return build_registry(
            ToolDeps(sessions=sessions, strategies=(), scope=scope)
        )

    stack.app.dependency_overrides[get_advance_deps] = lambda: AdvanceDeps(
        sessions=sessions,
        model=GuardedModel(source=source, breaker=CircuitBreaker(name="m")),
        tools=tools,
        summarizer=NullSummarizer(),
    )


async def _new_session(client: httpx.AsyncClient) -> str:
    response = await client.post(URL, json={"title": "问问"})
    assert response.status_code == 201
    return str(response.json()["data"]["id"])


def _events(body: str) -> list[tuple[str, dict[str, Any]]]:
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
        f"{URL}/{session_id}:advance", json={"client_tools": [ASK_TOOL], **body}
    )
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream")
    return _events(response.text)


async def test_a_plain_answer_streams_a_delta_a_step_then_done(
    db_stack: DbStack,
) -> None:
    _install(db_stack, ScriptedChat(reply=AIMessage(content="9.8 MPa [1]")))
    session_id = await _new_session(db_stack.client)

    events = await _advance(db_stack.client, session_id, user_text="上限多少")

    assert [name for name, _ in events] == [
        "message.delta",
        "step",
        "turn.done",
    ]
    assert events[-1][1]["reply"] == "9.8 MPa [1]"


async def test_the_turn_is_persisted_with_its_steps(
    db_stack: DbStack,
) -> None:
    _install(db_stack, ScriptedChat(reply=AIMessage(content="好")))
    session_id = await _new_session(db_stack.client)
    await _advance(db_stack.client, session_id, user_text="在吗")

    detail = await db_stack.client.get(f"{URL}/{session_id}")
    messages = detail.json()["data"]["messages"]

    assert [m["role"] for m in messages] == ["user", "assistant"]
    assert len(messages[-1]["steps"]) == 1


async def test_asking_the_user_stops_the_stream_and_is_recorded(
    db_stack: DbStack,
) -> None:
    """反问：模型调 user.ask → 流停在 client_tool.request → 库里留一步待续。"""
    _install(
        db_stack,
        ScriptedChat(
            script=[
                asks(
                    ASK_TOOL,
                    "q1",
                    question="哪台锅炉",
                    options=[
                        {"value": "k1", "label": "1 号"},
                        {"value": "k2", "label": "2 号"},
                    ],
                )
            ]
        ),
    )
    session_id = await _new_session(db_stack.client)

    events = await _advance(db_stack.client, session_id, user_text="上限多少")

    assert events[-1][0] == "client_tool.request"
    call = events[-1][1]["calls"][0]
    assert call["name"] == ASK_TOOL
    assert call["arguments"]["options"][0]["value"] == "k1"

    detail = await db_stack.client.get(f"{URL}/{session_id}")
    steps = detail.json()["data"]["messages"][-1]["steps"]
    assert [s["state"] for s in steps][-1] == "awaiting_client"


async def test_the_picked_option_resumes_the_turn(db_stack: DbStack) -> None:
    """回填之后模型接着答，且它看得见用户选了什么。"""
    model = ScriptedChat(
        script=[
            asks(ASK_TOOL, "q1", question="哪台", options=[]),
            AIMessage(content="1 号锅炉上限 9.8 MPa"),
        ]
    )
    _install(db_stack, model)
    session_id = await _new_session(db_stack.client)
    await _advance(db_stack.client, session_id, user_text="上限多少")

    events = await _advance(
        db_stack.client,
        session_id,
        tool_results=[{"call_id": "q1", "output": {"picked": ["k1"]}}],
    )

    assert events[-1][0] == "turn.done"
    assert "1 号" in events[-1][1]["reply"]
    fed = "".join(str(one.content) for one in model.seen[-1])
    assert "k1" in fed


async def test_the_ask_tool_is_not_offered_when_the_page_did_not_report_it(
    db_stack: DbStack,
) -> None:
    """⚠ 下发了模型会调，而那一页渲染不出选项——用户看到一个永远转圈的回合。"""
    model = ScriptedChat(reply=AIMessage(content="好"))
    _install(db_stack, model)
    session_id = await _new_session(db_stack.client)

    response = await db_stack.client.post(
        f"{URL}/{session_id}:advance",
        json={"user_text": "在吗", "client_tools": []},
    )

    assert response.status_code == 200
    # ⚠ 绑上去的是 OpenAI 形状：名字在 `function.name` 下，不在顶层
    offered = {
        str(one["function"]["name"])
        for one in model.bound
        if isinstance(one, dict) and "function" in one
    }
    assert ASK_TOOL not in offered
    assert "kb.search" in offered


async def test_text_and_tool_results_together_are_refused_up_front(
    db_stack: DbStack,
) -> None:
    _install(db_stack, ScriptedChat())
    session_id = await _new_session(db_stack.client)

    response = await db_stack.client.post(
        f"{URL}/{session_id}:advance",
        json={"user_text": "x", "tool_results": [{"call_id": "a"}]},
    )

    assert response.status_code == 400


async def test_the_thinking_is_streamed_but_never_stored(
    db_stack: DbStack,
) -> None:
    _install(db_stack, StreamingChat(parts=[("查到了", "先列库再检索")]))
    session_id = await _new_session(db_stack.client)

    events = await _advance(db_stack.client, session_id, user_text="上限")

    thoughts = [
        body["text"]
        for name, body in events
        if name == "message.delta" and body["channel"] == "reasoning"
    ]
    assert thoughts == ["先列库再检索"]
    detail = await db_stack.client.get(f"{URL}/{session_id}")
    stored = json.dumps(detail.json()["data"]["messages"], ensure_ascii=False)
    assert "先列库" not in stored


async def test_someone_elses_session_cannot_be_advanced(
    db_stack: DbStack,
) -> None:
    _install(db_stack, ScriptedChat())
    response = await db_stack.client.post(
        f"{URL}/{uuid.uuid4()}:advance", json={"user_text": "x"}
    )

    assert response.status_code == 404


async def test_no_chat_endpoint_means_an_honest_409(db_stack: DbStack) -> None:
    """⚠ 没接对话档时整个面如实不可用，而不是让模型「假装回答」。"""
    db_stack.app.dependency_overrides.pop(get_advance_deps, None)
    session_id = await _new_session(db_stack.client)

    response = await db_stack.client.post(
        f"{URL}/{session_id}:advance", json={"user_text": "在吗"}
    )

    assert response.status_code == 409
    assert response.json()["code"] == 42321
