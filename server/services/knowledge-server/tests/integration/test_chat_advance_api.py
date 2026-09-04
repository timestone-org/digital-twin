"""推进一个回合：事件流从头到尾走一遍，并且真的落库。

**这一条是整个对话面的验收点**：知识库工具就地跑、反问停下来等浏览器、
每一步都推出去、回合结束前落库、回填之后接着跑——在同一次请求里全走一遍。
"""

import json
import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

import httpx
import pytest
from integration.conftest import DbStack
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.chat.deps import get_advance_deps
from knowledge_server.apps.chat.services.advance_service import AdvanceDeps
from knowledge_server.apps.chat.services.citations import Ledger
from knowledge_server.apps.chat.services.scope import BaseScope
from knowledge_server.apps.chat.services.tools import ToolDeps, build_registry
from knowledge_server.apps.chat.services.tools.client import ASK_TOOL
from knowledge_server.apps.knowledge import crud
from knowledge_server.apps.knowledge.crud.figure import FigureWrite
from knowledge_server.apps.knowledge.models import (
    KnowledgeChunk,
    KnowledgeDocument,
)
from knowledge_server.apps.knowledge.schemas import HitOut, LocatorOut
from knowledge_server.settings import API_PREFIX
from lib.resilience import CircuitBreaker
from llmcore import ModelChoice
from llmcore.guard import GuardedModel
from llmcore.memory import NullSummarizer
from llmcore.testing import ScriptedChat, StreamingChat, asks
from llmcore.tools.registry import ToolRegistry, registry_of
from llmcore.tools.shapes import ToolSpec, object_schema

pytestmark = pytest.mark.requires_postgres

URL = f"{API_PREFIX}/chat-sessions"


def _install(
    stack: DbStack,
    model: BaseChatModel,
    tools: Callable[[BaseScope, Ledger], ToolRegistry] | None = None,
) -> None:
    """把假模型与用例那条连接装进推进依赖。

    Args: stack, model, tools（换掉整份工具注册表；不给就是真的那一份）。
    """

    async def source(_choice: ModelChoice) -> BaseChatModel:
        return model

    @asynccontextmanager
    async def sessions() -> AsyncIterator[AsyncSession]:
        async with stack.sessions() as session:
            yield session
            await session.commit()

    def real_tools(scope: BaseScope, ledger: Ledger) -> ToolRegistry:
        return build_registry(
            ToolDeps(
                sessions=sessions,
                strategies=(),
                scope=scope,
                ledger=ledger,
            )
        )

    stack.app.dependency_overrides[get_advance_deps] = lambda: AdvanceDeps(
        sessions=sessions,
        model=GuardedModel(source=source, breaker=CircuitBreaker(name="m")),
        tools=tools or real_tools,
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


@dataclass(frozen=True)
class _MarkingSearch:
    """只做「发一个角标」这一件事的假检索。

    ⚠ 用假件而不是把真检索拖进来：这一条要验的是「发角标 → 落库 → 回放」
    这条链，而真检索要一整套向量索引——拖进来之后这条链断在哪一段就看不出来了。
    """

    hit: HitOut
    ledger: Ledger
    name = "marking"

    def specs(self) -> tuple[ToolSpec, ...]:
        return (
            ToolSpec(
                name="kb.search",
                description="检索",
                parameters=object_schema({}, []),
                runs_on="server",
            ),
        )

    async def run(self, name: str, arguments: dict[str, Any]) -> Any:
        del name, arguments
        return {"mark": self.ledger.mark(self.hit, "现场资料", self.hit.text)}


_FIGURE_HASH = "e" * 64


async def _seeded_chunk(session: AsyncSession) -> KnowledgeChunk:
    """建一个库、一份文档与一块，回那一块。"""
    base = await crud.knowledge_base.insert_base(
        session,
        crud.knowledge_base.BaseWrite(
            name=f"引用测试 {uuid.uuid4().hex[:6]}",
            description="",
            owner_id="tester",
            embedding_model=None,
            dimensions=None,
            retrieval_strategy="hybrid",
        ),
    )
    source = await crud.source.insert_source(
        session, base.id, "upload", "上传", {}
    )
    document = KnowledgeDocument(
        base_id=base.id,
        source_id=source.id,
        external_ref="knowledge/x/规程.pdf",
        title="冷却水系统操作规程",
        content_hash="d" * 64,
    )
    session.add(document)
    await session.flush()
    chunk = KnowledgeChunk(
        base_id=base.id,
        document_id=document.id,
        ordinal=0,
        text="冷凝器出口温度不得高于 65 ℃",
    )
    session.add(chunk)
    await session.flush()
    return chunk


async def _seeded_with_a_figure(
    stack: DbStack,
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    """在那一块上再挂一张图；回文档 id、块 id 与图 id。"""
    async with stack.sessions() as session:
        chunk = await _seeded_chunk(session)
        made = await crud.figure.replace_figures(
            session,
            chunk.base_id,
            chunk.document_id,
            [
                FigureWrite(
                    ordinal=0,
                    kind="image",
                    page=2,
                    caption="图 1 冷却水回路",
                    object_key="knowledge/x/y/figures/e.jpg",
                    media_type="image/jpeg",
                    byte_size=64,
                    content_hash=_FIGURE_HASH,
                    bbox={},
                )
            ],
        )
        figure_id = made[_FIGURE_HASH]
        await crud.figure.link_figures(session, [(chunk.id, figure_id, 0)])
        await session.commit()
        return chunk.document_id, chunk.id, figure_id


async def test_the_citations_survive_a_reload_with_their_figures(
    db_stack: DbStack,
) -> None:
    """⚠ 引用只作为一帧流出去的话，重开这条对话整块依据凭空消失——而文档解析
    出来的那几张插图**只挂在依据上**，现象是「问的时候看得见图，回来就没了」。
    """
    document_id, chunk_id, figure_id = await _seeded_with_a_figure(db_stack)
    hit = HitOut(
        chunk_id=chunk_id,
        document_id=document_id,
        document_title="冷却水系统操作规程",
        text="冷凝器出口温度不得高于 65 ℃",
        heading_path="二、运行参数",
        locator=LocatorOut(page=2, label="第 2 页 · 二、运行参数"),
        score=0.9,
        why="关键词命中",
    )
    _install(
        db_stack,
        ScriptedChat(
            script=[
                AIMessage(
                    content="",
                    tool_calls=[
                        {"id": "t1", "name": "kb.search", "args": {}},
                    ],
                ),
                AIMessage(content="上限是 65 ℃①"),
            ]
        ),
        tools=lambda _scope, ledger: registry_of(
            (_MarkingSearch(hit, ledger),)
        ),
    )
    session_id = await _new_session(db_stack.client)

    events = await _advance(db_stack.client, session_id, user_text="上限多少")

    live = [body for name, body in events if name == "citations"]
    assert len(live) == 1

    detail = await db_stack.client.get(f"{URL}/{session_id}")
    cited = detail.json()["data"]["messages"][-1]["citations"]
    assert [one["marker"] for one in cited] == ["①"]
    assert cited[0]["document_id"] == str(document_id)
    assert [fig["id"] for fig in cited[0]["figures"]] == [str(figure_id)]
    # 回放那一份与直播那一帧逐字相同：各摊一遍的话，回放会少一格而两边单看都对
    assert cited == live[0]["items"]


async def test_a_turn_without_markers_stores_no_citations(
    db_stack: DbStack,
) -> None:
    """⚠ 空表落成 `NULL`：一条空依据在界面上会让用户以为出了什么问题。"""
    _install(db_stack, ScriptedChat(reply=AIMessage(content="资料里没写")))
    session_id = await _new_session(db_stack.client)
    await _advance(db_stack.client, session_id, user_text="上限多少")

    detail = await db_stack.client.get(f"{URL}/{session_id}")
    assert detail.json()["data"]["messages"][-1]["citations"] == []
