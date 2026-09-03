"""对话的检索范围，打真库：会话面读写它，工具层照它硬过滤（ADR-0044）。

**三个工具的越界拦截是这一条的验收点**：列库只列范围内的，检索与看整块越界即抛。
`kb.read_chunk` 那一道尤其要在真库上验——它拦的是「模型从历史消息里翻出一个越界
的 chunk_id」，而假会话上根本走不到那一步。
"""

import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from typing import Any

import httpx
import pytest
from integration.conftest import CommittingSession, DbStack
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.chat.services.scope import (
    ALL_BASES,
    BaseOutOfScope,
    BaseScope,
    ScopeBase,
)
from knowledge_server.apps.chat.services.tools.knowledge import (
    LIST_BASES,
    READ_CHUNK,
    SEARCH,
    KnowledgeTools,
)
from knowledge_server.apps.knowledge import crud
from knowledge_server.apps.knowledge.services.chunking import Chunk
from knowledge_server.settings import API_PREFIX

pytestmark = pytest.mark.requires_postgres

URL = f"{API_PREFIX}/chat-sessions"
BASES = f"{API_PREFIX}/knowledge-bases"

Sessions = Callable[[], CommittingSession]


async def _base(client: httpx.AsyncClient, name: str) -> str:
    response = await client.post(BASES, json={"name": name})
    assert response.status_code == 201, response.text
    return str(response.json()["data"]["id"])


async def _create(client: httpx.AsyncClient, **body: Any) -> dict[str, Any]:
    response = await client.post(URL, json=body)
    assert response.status_code == 201, response.text
    data: dict[str, Any] = response.json()["data"]
    return data


def _tools(sessions: Sessions, scope: BaseScope) -> KnowledgeTools:
    """按这个范围造一路知识库工具，会话取用例那条回滚连接。

    Args: sessions, scope。
    """

    @asynccontextmanager
    async def opened() -> AsyncIterator[AsyncSession]:
        async with sessions() as session:
            yield session

    return KnowledgeTools(sessions=opened, strategies=(), scope=scope)


async def _seed_chunk(sessions: Sessions, base_id: uuid.UUID) -> uuid.UUID:
    """给一个库塞一份文档与一块正文，回那一块的 id。

    Args: sessions, base_id。
    """
    document_id = uuid.uuid4()
    async with sessions() as session:
        source = await crud.source.insert_source(
            session, base_id, "upload", "上传", {}
        )
        await crud.document.insert_document(
            session,
            crud.document.DocumentWrite(
                document_id=document_id,
                base_id=base_id,
                source_id=source.id,
                external_ref="手册.md",
                title="手册.md",
                media_type="text/markdown",
                object_key="k",
                byte_size=8,
                content_hash=uuid.uuid4().hex * 2,
            ),
        )
        made = await crud.chunk.replace_chunks(
            session,
            base_id,
            document_id,
            [Chunk(ordinal=0, text="出口温度不得高于 65 ℃")],
        )
    return made[0]


async def test_a_new_session_defaults_to_every_base(
    db_client: httpx.AsyncClient,
) -> None:
    """⚠ 不给范围就是全部：`null` 而不是空表，两者必须分得开。"""
    made = await _create(db_client)

    assert made["base_scope"] is None


async def test_a_scope_comes_back_with_the_base_names(
    db_client: httpx.AsyncClient,
) -> None:
    """⚠ 只回一串 uuid 的话前端显示不出人话，还要自己再查一遍。"""
    base_id = await _base(db_client, "手册库")

    made = await _create(db_client, base_scope_ids=[base_id])
    listed = await db_client.get(URL)
    detail = await db_client.get(f"{URL}/{made['id']}")

    assert made["base_scope"] == [
        {"base_id": base_id, "name": "手册库", "is_missing": False}
    ]
    rows = [
        one for one in listed.json()["data"]["items"] if one["id"] == made["id"]
    ]
    assert rows[0]["base_scope"][0]["name"] == "手册库"
    assert detail.json()["data"]["base_scope"][0]["name"] == "手册库"


async def test_an_empty_scope_is_refused(db_client: httpx.AsyncClient) -> None:
    """⚠ 「一个都没选」不许被当成「不限库」：那会把检索悄悄扩回全部库。"""
    response = await db_client.post(URL, json={"base_scope_ids": []})

    assert response.status_code == 400


async def test_a_base_that_does_not_exist_is_refused(
    db_client: httpx.AsyncClient,
) -> None:
    """⚠ 认不出的 id 整笔拒，不悄悄丢掉——丢完了范围就成了「全部」。"""
    response = await db_client.post(
        URL, json={"base_scope_ids": [str(uuid.uuid4())]}
    )

    assert response.status_code == 400
    assert response.json()["code"] == 42322


async def test_changing_the_scope_bumps_the_row_version(
    db_client: httpx.AsyncClient,
) -> None:
    made = await _create(db_client)
    base_id = await _base(db_client, "手册库")

    changed = await db_client.patch(
        f"{URL}/{made['id']}",
        json={"base_scope_ids": [base_id], "expected_version": 1},
    )

    assert changed.status_code == 200
    assert changed.json()["data"]["row_version"] == 2
    assert changed.json()["data"]["base_scope"][0]["base_id"] == base_id


async def test_a_stale_version_is_a_conflict_not_a_silent_overwrite(
    db_client: httpx.AsyncClient,
) -> None:
    """⚠ 两个标签页开着同一条会话时，无条件覆盖会把先写的范围悄悄顶掉。"""
    made = await _create(db_client)
    base_id = await _base(db_client, "手册库")
    await db_client.patch(
        f"{URL}/{made['id']}", json={"base_scope_ids": [base_id]}
    )

    stale = await db_client.patch(
        f"{URL}/{made['id']}",
        json={"base_scope_ids": [base_id], "expected_version": 1},
    )

    assert stale.status_code == 409
    assert stale.json()["code"] == 42323


async def test_a_null_scope_widens_back_to_every_base(
    db_client: httpx.AsyncClient,
) -> None:
    """⚠ 这一格上的 `null` 是「改回全部」，与缺省（本次不涉及）不同。"""
    base_id = await _base(db_client, "手册库")
    made = await _create(db_client, base_scope_ids=[base_id])

    widened = await db_client.patch(
        f"{URL}/{made['id']}", json={"base_scope_ids": None}
    )
    touched = await db_client.patch(f"{URL}/{made['id']}", json={})

    assert widened.json()["data"]["base_scope"] is None
    assert touched.json()["data"]["base_scope"] is None


async def test_a_deleted_base_stays_in_the_scope_and_says_so(
    db_client: httpx.AsyncClient,
) -> None:
    """⚠ 不静默抹掉、也不因此扩大范围：抹掉等于替用户把边界改宽。"""
    base_id = await _base(db_client, "手册库")
    made = await _create(db_client, base_scope_ids=[base_id])

    dropped = await db_client.delete(f"{BASES}/{base_id}")
    detail = await db_client.get(f"{URL}/{made['id']}")
    scope = detail.json()["data"]["base_scope"]

    assert dropped.status_code in (200, 204)
    assert scope == [{"base_id": base_id, "name": "", "is_missing": True}]


async def test_list_bases_only_shows_the_ones_in_scope(
    db_stack: DbStack, db_sessions: Sessions
) -> None:
    inside = uuid.UUID(await _base(db_stack.client, "范围内"))
    outside = uuid.UUID(await _base(db_stack.client, "范围外"))
    scope = BaseScope(
        bases=(ScopeBase(base_id=inside, name="范围内", is_missing=False),)
    )

    listed = await _tools(db_sessions, scope).run(LIST_BASES, {})
    every = await _tools(db_sessions, ALL_BASES).run(LIST_BASES, {})

    names = {one["name"] for one in listed["bases"]}
    assert names == {"范围内"}
    assert listed["total"] == 1
    assert "范围外" in {one["name"] for one in every["bases"]}
    assert str(outside) not in {one["id"] for one in listed["bases"]}


async def test_searching_a_base_outside_the_scope_is_an_honest_refusal(
    db_stack: DbStack, db_sessions: Sessions
) -> None:
    """⚠ 抛而不是回空表：空表与「这个库里确实没这句话」长得一模一样。"""
    inside = uuid.UUID(await _base(db_stack.client, "范围内"))
    outside = uuid.UUID(await _base(db_stack.client, "范围外"))
    scope = BaseScope(
        bases=(ScopeBase(base_id=inside, name="范围内", is_missing=False),)
    )

    with pytest.raises(BaseOutOfScope, match="范围"):
        await _tools(db_sessions, scope).run(
            SEARCH, {"base_id": str(outside), "query": "出口温度"}
        )


async def test_reading_a_chunk_from_outside_the_scope_is_refused(
    db_stack: DbStack, db_sessions: Sessions
) -> None:
    """⚠ 这一道最容易漏：前两个拦住了，模型仍可能从历史消息里翻出一个越界的
    `chunk_id`，而它拿到的是整段原文。"""
    inside = uuid.UUID(await _base(db_stack.client, "范围内"))
    outside = uuid.UUID(await _base(db_stack.client, "范围外"))
    chunk_id = await _seed_chunk(db_sessions, outside)
    scope = BaseScope(
        bases=(ScopeBase(base_id=inside, name="范围内", is_missing=False),)
    )

    with pytest.raises(BaseOutOfScope, match="范围"):
        await _tools(db_sessions, scope).run(
            READ_CHUNK, {"chunk_id": str(chunk_id)}
        )


async def test_reading_a_chunk_inside_the_scope_still_works(
    db_stack: DbStack, db_sessions: Sessions
) -> None:
    """拦截不许顺手把合法的那一条也拦了。"""
    inside = uuid.UUID(await _base(db_stack.client, "范围内"))
    chunk_id = await _seed_chunk(db_sessions, inside)
    scope = BaseScope(
        bases=(ScopeBase(base_id=inside, name="范围内", is_missing=False),)
    )

    found = await _tools(db_sessions, scope).run(
        READ_CHUNK, {"chunk_id": str(chunk_id)}
    )

    assert "出口温度" in found["text"]
