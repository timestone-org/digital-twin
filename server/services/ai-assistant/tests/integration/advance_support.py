"""AI回合HTTP集成测试公共装配；只用回滚数据库和脚本模型。"""

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import httpx
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage
from sqlalchemy.ext.asyncio import AsyncSession

from ai_assistant.apps.chat.deps import get_advance_deps
from ai_assistant.apps.chat.services.advance_service import AdvanceDeps
from ai_assistant.apps.chat.services.memory import NullSummarizer
from ai_assistant.apps.chat.services.tools.providers.server import ServerTools
from ai_assistant.llm import GuardedModel
from ai_assistant.llm.ports import ModelChoice, ModelKind
from integration.conftest import DbStack
from lib.resilience import CircuitBreaker
from llmcore.testing import tool_call

SESSIONS_URL = "/api/v1/assistant/sessions"


def asks(tool: str, call_id: str, /, **arguments: Any) -> AIMessage:
    return AIMessage(
        content="", tool_calls=[tool_call(tool, call_id, **arguments)]
    )


def install(
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


async def new_session(client: httpx.AsyncClient) -> str:
    response = await client.post(
        SESSIONS_URL,
        json={"surface_kind": "dashboard-editor", "title": "绑点"},
    )
    assert response.status_code == 201
    return str(response.json()["data"]["id"])


def events(body: str) -> list[tuple[str, dict[str, Any]]]:
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


async def advance(
    client: httpx.AsyncClient, session_id: str, **body: Any
) -> list[tuple[str, dict[str, Any]]]:
    response = await client.post(
        f"{SESSIONS_URL}/{session_id}:advance",
        json={"surface_kind": "dashboard-editor", **body},
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    return events(response.text)
