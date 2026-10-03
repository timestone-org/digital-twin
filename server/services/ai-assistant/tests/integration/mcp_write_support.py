"""MCP 确认集成测试装配：真实隔离事务与 HTTP 边界替身。"""

import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from fastapi import FastAPI
from langchain_core.messages import AIMessage
from sqlalchemy import delete

from ai_assistant.app import build_app
from ai_assistant.apps.chat.api.mcp_writes import get_mcp_write_service
from ai_assistant.apps.chat.deps import get_advance_deps
from ai_assistant.apps.chat.models import ChatMessage, ChatSession, ChatStep
from ai_assistant.apps.chat.services.advance_service import AdvanceDeps
from ai_assistant.apps.chat.services.mcp_writes import (
    McpWriteDeps,
    McpWriteService,
)
from ai_assistant.apps.chat.services.memory import NullSummarizer
from ai_assistant.apps.chat.services.tools.mcp_policy import policies_of
from ai_assistant.apps.chat.services.tools.providers.mcp import McpTools
from ai_assistant.apps.chat.services.tools.providers.server import ServerTools
from ai_assistant.llm import GuardedModel
from ai_assistant.llm.ports import ModelChoice
from ai_assistant.settings import Settings
from ai_assistant.upstream.auth import AuthClient
from ai_assistant.upstream.mcp import McpCatalog, McpClient, McpServer
from ai_assistant.upstream.platform import PlatformClient
from lib.auth import (
    SignedContext,
    encode_identity,
    encode_permissions,
    sign_context,
)
from lib.db import Database
from lib.resilience import CircuitBreaker
from llmcore.testing import ScriptedChat, tool_call

OWNER = uuid.UUID("10000000-0000-0000-0000-000000000001")


OTHER = uuid.UUID("10000000-0000-0000-0000-000000000002")


TARGET = "20000000-0000-0000-0000-000000000001"


FULL = frozenset({"assistant:use", "dashboard:view", "dashboard:edit"})


BASE = "/api/v1/assistant/sessions"


FIXED_NOW = datetime(2035, 1, 1, tzinfo=UTC)


TOOL_NAME = "mcp.audit.save"


def headers(
    owner: uuid.UUID, codes: frozenset[str], now: datetime
) -> dict[str, str]:
    """合成签名身份，不读取本机配置。Args: owner, codes, now。"""
    context = SignedContext(
        str(owner),
        encode_identity("admin"),
        encode_permissions(codes),
        int((now + timedelta(minutes=10)).timestamp()),
    )
    return {
        "X-Auth-User-Id": str(owner),
        "X-Auth-Username": encode_identity("审核"),
        "X-Auth-Role": context.role,
        "X-Auth-Permissions": context.permissions_b64,
        "X-Auth-Exp": str(context.expires_at),
        "X-Auth-Sig": sign_context("s" * 32, context),
    }


@dataclass
class External:
    """独立进程的 HTTP 行为替身；没有模型、OAuth或真实设备请求。"""

    now: datetime = FIXED_NOW
    codes: frozenset[str] = FULL
    auth_mode: str = "normal"
    schema_version: int = 1
    has_tool: bool = True
    target_status: int = 200
    is_target_blocked: bool = False
    target_entered: asyncio.Event = field(default_factory=asyncio.Event)
    target_release: asyncio.Event = field(default_factory=asyncio.Event)
    execution_mode: str = "success"
    auth_calls: int = 0
    dispatches: list[dict[str, Any]] = field(default_factory=list)
    entered: asyncio.Event = field(default_factory=asyncio.Event)
    release: asyncio.Event = field(default_factory=asyncio.Event)

    def auth(self, request: httpx.Request) -> httpx.Response:
        assert request.url.path == f"/internal/v1/users/{OWNER}/edge-headers"
        self.auth_calls += 1
        if self.auth_mode == "unavailable":
            return httpx.Response(503)
        owner = OTHER if self.auth_mode == "wrong_owner" else OWNER
        result = headers(owner, self.codes, self.now)
        if self.auth_mode == "expired":
            result = headers(owner, self.codes, FIXED_NOW - timedelta(days=1))
        if self.auth_mode == "bad_signature":
            result["X-Auth-Sig"] = "forged"
        return httpx.Response(200, headers=result)

    async def platform(self, request: httpx.Request) -> httpx.Response:
        assert request.url.path == f"/api/v1/platform/dashboards/{TARGET}"
        assert request.headers["X-Auth-User-Id"] == str(OWNER)
        if self.is_target_blocked:
            self.target_entered.set()
            await self.target_release.wait()
        return httpx.Response(self.target_status, json={"data": {"id": TARGET}})

    async def mcp(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        if body["method"] == "tools/list":
            tools = (
                [
                    {
                        "name": "save",
                        "description": "audit only",
                        "inputSchema": {
                            "type": "object",
                            "version": self.schema_version,
                            "properties": {"target_id": {"type": "string"}},
                        },
                    }
                ]
                if self.has_tool
                else []
            )
            return httpx.Response(
                200,
                json={"jsonrpc": "2.0", "id": 1, "result": {"tools": tools}},
            )
        assert body["method"] == "tools/call"
        self.dispatches.append(body["params"])
        self.entered.set()
        if self.execution_mode == "blocked":
            await self.release.wait()
        if self.execution_mode == "timeout":
            raise httpx.ReadTimeout("synthetic timeout")
        result = {"saved": True}
        if self.execution_mode == "tool_error":
            result = {
                "isError": True,
                "content": [{"type": "text", "text": "synthetic failure"}],
            }
        return httpx.Response(
            200, json={"jsonrpc": "2.0", "id": 1, "result": result}
        )


@dataclass(frozen=True)
class Stack:
    """真实独立事务及真实 ASGI 路由。"""

    client: httpx.AsyncClient
    database: Database
    service: McpWriteService
    external: External
    session_id: uuid.UUID
    step_id: uuid.UUID
    app: FastAPI
    deps: McpWriteDeps

    @property
    def url(self) -> str:
        return f"{BASE}/{self.session_id}/mcp-writes/write"

    async def prepare(self) -> str:
        response = await self.client.post(f"{self.url}:prepare")
        assert response.status_code == 200, response.text
        data = response.json()["data"]
        assert data["tool_name"] == TOOL_NAME
        assert data["arguments"] == {"target_id": TARGET, "label": "original"}
        assert data["target"] == f"dashboard:{TARGET}"
        return str(data["ticket"])

    async def decide(
        self, ticket: str, is_confirmed: bool = True
    ) -> httpx.Response:
        return await self.client.post(
            f"{self.url}:decide",
            json={"ticket": ticket, "confirm": is_confirmed},
        )

    async def step(self) -> ChatStep:
        async with self.database.session() as session:
            step = await session.get(ChatStep, self.step_id)
            assert step is not None
            return step


@asynccontextmanager
async def open_stack(db_settings: Settings) -> AsyncIterator[Stack]:
    settings = db_settings.model_copy(
        update={
            "mcp_write_allowed": json.dumps([TOOL_NAME]),
            "mcp_write_policies": json.dumps(
                {
                    TOOL_NAME: {
                        "required_codes": ["dashboard:view", "dashboard:edit"],
                        "target_parameter": "target_id",
                        "impact": "保存审核看板",
                    }
                }
            ),
        }
    )
    app = build_app(settings)
    database = app.state.container.database
    external = External()
    deps = external_deps(database, settings, external)
    service = McpWriteService(deps, clock=lambda: external.now)
    app.dependency_overrides[get_mcp_write_service] = lambda: service
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://assistant.test",
        headers=headers(OWNER, FULL, FIXED_NOW),
    ) as client:
        session_id, step_id = await seed(database)
        yield Stack(
            client, database, service, external, session_id, step_id, app, deps
        )
        async with database.session() as session:
            await session.execute(
                delete(ChatSession).where(ChatSession.id == session_id)
            )
    await deps.auth.close()
    await deps.platform.close()
    await deps.catalog.client.close()
    await database.dispose()


async def seed(database: Database) -> tuple[uuid.UUID, uuid.UUID]:
    """新会话及待确认调用仅保存在本用例的隔离库。Args: database。"""
    async with database.session() as session:
        owner = ChatSession(
            user_id=OWNER, surface_kind="dashboard-editor", title="隔离 MCP"
        )
        session.add(owner)
        await session.flush()
        user = ChatMessage(
            session_id=owner.id,
            seq=1,
            role="user",
            content_json={"text": "保存审核看板"},
        )
        assistant = ChatMessage(
            session_id=owner.id,
            seq=2,
            role="assistant",
            content_json={"text": "等待确认"},
        )
        session.add_all([user, assistant])
        await session.flush()
        step = ChatStep(
            message_id=assistant.id,
            seq=1,
            kind="client_tool",
            name=TOOL_NAME,
            state="awaiting_client",
            input_json={
                "call_id": "write",
                "arguments": {"target_id": TARGET, "label": "original"},
                "_mcp_confirmation_protocol": 1,
            },
        )
        session.add(step)
        await session.flush()
        return owner.id, step.id


async def change_pending(stack: Stack, change: str) -> None:
    """独立事务模拟历史晚到、旧协议及服务端入参改变。Args: stack, change。"""
    async with stack.database.session() as session:
        step = await session.get(ChatStep, stack.step_id)
        assert step is not None
        if change == "arguments":
            step.input_json = {
                **step.input_json,
                "arguments": {"target_id": TARGET, "label": "changed"},
            }
        elif change == "legacy":
            step.input_json = {
                key: value
                for key, value in step.input_json.items()
                if key != "_mcp_confirmation_protocol"
            }
        else:
            session.add(
                ChatMessage(
                    session_id=stack.session_id,
                    seq=3,
                    role="user",
                    content_json={"text": "new turn"},
                )
            )


def external_deps(
    database: Database, settings: Settings, external: External
) -> McpWriteDeps:
    """所有进程外端点以 HTTP 传输替身隔离。

    Args: database, settings, external。
    """
    auth = AuthClient(
        base_url="http://auth.test", service_key="k" * 32, timeout_s=1
    )
    auth.use_transport(httpx.MockTransport(external.auth))
    platform = PlatformClient(base_url="http://platform.test", timeout_s=1)
    platform.use_transport(httpx.MockTransport(external.platform))
    mcp = McpClient(timeout_s=1)
    mcp.use_transport(httpx.MockTransport(external.mcp))
    catalog = McpCatalog(
        client=mcp,
        servers=(McpServer("audit", "http://mcp.test"),),
        tokens={},
        breakers={"audit": CircuitBreaker(name="audit")},
    )
    return McpWriteDeps(database.session, settings, auth, catalog, platform)


async def install_mcp_model(stack: Stack) -> None:
    """真实推进服务仅在模型进程边界使用脚本替身。Args: stack。"""
    async with stack.database.session() as session:
        await session.execute(
            delete(ChatMessage).where(
                ChatMessage.session_id == stack.session_id
            )
        )
    await stack.deps.catalog.refresh()
    tools = McpTools(
        catalog=stack.deps.catalog,
        write_allowed=stack.deps.settings.mcp_write_names(),
        write_policies=policies_of(stack.deps.settings),
        codes=FULL,
    )
    model = ScriptedChat(
        script=[
            AIMessage(
                content="",
                tool_calls=[
                    tool_call(
                        TOOL_NAME, "write", target_id=TARGET, label="original"
                    )
                ],
            )
        ]
    )

    async def source(_choice: ModelChoice) -> ScriptedChat:
        return model

    deps = AdvanceDeps(
        sessions=stack.database.session,
        model=GuardedModel(source=source, breaker=CircuitBreaker(name="model")),
        server_tools=ServerTools(),
        summarizer=lambda _profile: NullSummarizer(),
        extra_specs=tools.specs(),
        codes=FULL,
    )
    stack.app.dependency_overrides[get_advance_deps] = lambda: deps


def install_deadline(stack: Stack) -> None:
    """缩短真实事件循环外部等待预算，数据库事务保持真实。Args: stack。"""
    service = McpWriteService(
        stack.deps, clock=lambda: stack.external.now, deadline_s=0.5
    )
    stack.app.dependency_overrides[get_mcp_write_service] = lambda: service


async def add_unrelated_blocked_server(stack: Stack) -> None:
    """与当前调用无关的 MCP 永久等待不应拖慢确认。Args: stack。"""
    unrelated = McpServer("unrelated", "http://unrelated.test")
    stack.deps.catalog.servers = (unrelated, *stack.deps.catalog.servers)
    stack.deps.catalog.breakers["unrelated"] = CircuitBreaker(name="unrelated")
    release = asyncio.Event()

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "unrelated.test":
            await release.wait()
        return await stack.external.mcp(request)

    stack.deps.catalog.client.use_transport(httpx.MockTransport(handler))
