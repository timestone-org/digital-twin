"""独立回合引用只使用已通过当前范围校验的文档。"""

import uuid
from typing import Any

import pytest
from conftest import HeaderFactory
from integration.conftest import DbStack
from integration.test_chat_advance_api import (
    URL,
    _advance,
    _install,
    _new_session,
    _seeded_chunk,
)
from langchain_core.messages import AIMessage, ToolMessage
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge.models import KnowledgeDocument
from knowledge_server.apps.knowledge.schemas import (
    HitOut,
    LocatorOut,
    SearchIn,
    SearchOut,
)
from knowledge_server.apps.knowledge.services import search_service
from knowledge_server.apps.knowledge.services.retrieval import RetrievalStrategy
from llmcore.testing import ScriptedChat, asks

pytestmark = pytest.mark.requires_postgres


@pytest.fixture
async def materials(
    db_stack: DbStack, monkeypatch: pytest.MonkeyPatch
) -> tuple[tuple[uuid.UUID, HitOut], tuple[uuid.UUID, HitOut]]:
    async with db_stack.sessions() as session:
        first = await _seeded_chunk(session)
        second = await _seeded_chunk(session)
        first.text = "合成规程甲：出口上限为65 ℃"
        second.text = "合成规程乙：另一设备的出口温度98 ℃"
        first.locator_json = {"page": 2}
        for row, title in ((first, "合成规程甲"), (second, "合成规程乙")):
            document = await session.get(KnowledgeDocument, row.document_id)
            assert document is not None
            document.title = title
        await session.commit()
    old = HitOut(
        chunk_id=first.id,
        document_id=first.document_id,
        document_title="合成规程甲",
        heading_path="设备温度",
        locator=LocatorOut(page=2, label="第2页"),
        text=first.text,
        score=0.9,
        why="合成检索",
    )
    new = old.model_copy(
        update={
            "chunk_id": second.id,
            "document_id": second.document_id,
            "document_title": "合成规程乙",
            "text": second.text,
        }
    )
    hits = {first.base_id: old, second.base_id: new}

    async def search(
        _session: AsyncSession,
        _strategies: tuple[RetrievalStrategy, ...],
        base_id: uuid.UUID,
        _body: SearchIn,
    ) -> SearchOut:
        return SearchOut(
            hits=[hits[base_id]],
            strategy="hybrid",
            rounds=1,
            is_complete=True,
            note="",
        )

    monkeypatch.setattr(search_service, "search", search)
    return (first.base_id, old), (second.base_id, new)


def _search(case: str, base_id: uuid.UUID) -> AIMessage:
    return asks("kb.search", case, base_id=str(base_id), query="出口温度")


def _read(case: str, hit: HitOut) -> AIMessage:
    return asks("kb.read_chunk", case, chunk_id=str(hit.chunk_id))


def _citations(
    events: list[tuple[str, dict[str, Any]]],
) -> list[dict[str, Any]]:
    return next(
        (body["items"] for event, body in events if event == "citations"), []
    )


async def test_followup_projects_history_and_registers_the_old_block_again(
    db_stack: DbStack,
    materials: tuple[tuple[uuid.UUID, HitOut], tuple[uuid.UUID, HitOut]],
) -> None:
    (old_base, old), (new_base, new) = materials
    model = ScriptedChat(
        script=[
            _search("old-search", old_base),
            AIMessage(content="甲规程上限65 ℃①；函数 f(3)，④为分点。"),
            _search("new-search", new_base),
            _read("reuse-old", old),
            AIMessage(content="沿用甲规程的65 ℃②，乙仅作背景①"),
        ]
    )
    _install(db_stack, model)
    session_id = await _new_session(db_stack.client)
    earlier = await _advance(
        db_stack.client, session_id, user_text="甲的上限？"
    )
    following = await _advance(
        db_stack.client, session_id, user_text="沿用上一轮甲规程，乙仅作补充"
    )

    receipts = {
        one.tool_call_id: str(one.content)
        for one in model.seen[-1]
        if isinstance(one, ToolMessage)
    }
    assert "①" not in receipts["old-search"]
    assert 'mark: "①"' in receipts["new-search"]
    assert 'mark: "②"' in receipts["reuse-old"]
    historical = next(
        m.content for m in model.seen[-1] if "甲规程上限65" in str(m.content)
    )
    assert "①" not in historical
    assert str(old.chunk_id) in historical
    assert "f(3)" in historical
    assert "（4）为分点" in historical
    assert [row["chunk_id"] for row in _citations(following)] == [
        str(old.chunk_id),
        str(new.chunk_id),
    ]
    assert _citations(following)[0]["where"] == "第 2 页"
    detail = (await db_stack.client.get(f"{URL}/{session_id}")).json()["data"]
    old_reply = next(row for row in detail["messages"] if row["citations"])
    assert (
        old_reply["content_json"]["text"]
        == "甲规程上限65 ℃①；函数 f(3)，④为分点。"
    )
    assert old_reply["citations"] == _citations(earlier)


async def test_a_narrowed_scope_cannot_register_the_historical_block(
    db_stack: DbStack,
    materials: tuple[tuple[uuid.UUID, HitOut], tuple[uuid.UUID, HitOut]],
) -> None:
    (old_base, old), (new_base, new) = materials
    model = ScriptedChat(
        script=[
            _search("old-search", old_base),
            AIMessage(content="甲规程上限65 ℃①"),
            _read("out-of-scope", old),
            _search("in-scope", new_base),
            AIMessage(content="甲不在当前范围，乙提供了背景①"),
        ]
    )
    _install(db_stack, model)
    session_id = await _new_session(db_stack.client)
    await _advance(db_stack.client, session_id, user_text="甲的上限？")
    updated = await db_stack.client.patch(
        f"{URL}/{session_id}",
        json={"base_scope_ids": [str(new_base)], "expected_version": 1},
    )
    assert updated.status_code == 200

    events = await _advance(
        db_stack.client, session_id, user_text="继续用上一轮甲规程作为来源"
    )

    receipt = next(
        str(one.content)
        for one in model.seen[-1]
        if isinstance(one, ToolMessage) and one.tool_call_id == "out-of-scope"
    )
    assert "不在" in receipt or "没有这个库" in receipt
    assert "mark:" not in receipt
    assert [row["chunk_id"] for row in _citations(events)] == [
        str(new.chunk_id)
    ]


async def test_a_caller_without_use_permission_cannot_reopen_an_old_source(
    db_stack: DbStack,
    sign: HeaderFactory,
    materials: tuple[tuple[uuid.UUID, HitOut], tuple[uuid.UUID, HitOut]],
) -> None:
    (old_base, old), _ = materials
    model = ScriptedChat(
        script=[
            _search("old-search", old_base),
            AIMessage(content="甲规程上限65 ℃①"),
            _read("unauthorized-reuse", old),
        ]
    )
    _install(db_stack, model)
    session_id = await _new_session(db_stack.client)
    await _advance(db_stack.client, session_id, user_text="甲的上限？")
    before = len(model.seen)

    denied = await db_stack.client.post(
        f"{URL}/{session_id}:advance",
        headers=sign(()),
        json={"user_text": "继续用上一轮甲规程", "client_tools": []},
    )

    assert denied.status_code == 403
    assert len(model.seen) == before
