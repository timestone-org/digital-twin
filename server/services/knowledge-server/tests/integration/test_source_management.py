"""来源编辑、解绑和既有资料的实际管理契约。"""

import hashlib
import uuid

import httpx
import pytest
from integration.conftest import DbStack, HeaderFactory

from knowledge_server.apps.knowledge.models import (
    KnowledgeChunk,
    KnowledgeDocument,
    KnowledgeSource,
)
from knowledge_server.apps.knowledge.services.sources import PlatformSource
from knowledge_server.settings import API_PREFIX
from lib.errors import ValidationFailed

pytestmark = pytest.mark.requires_postgres
BASES = f"{API_PREFIX}/knowledge-bases"
SOURCES = f"{API_PREFIX}/sources"


async def _created(
    client: httpx.AsyncClient,
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    made = (await client.post(BASES, json={"name": "管理验收库"})).json()[
        "data"
    ]
    path = f"{BASES}/{made['id']}/sources"
    initial = (await client.get(path)).json()["data"]
    source = await client.post(
        path,
        json={
            "name": "本地来源",
            "kind": "platform",
            "config": {"path": "/api/v1/platform/items"},
        },
    )
    assert source.status_code == 201
    return (
        uuid.UUID(made["id"]),
        uuid.UUID(source.json()["data"]["id"]),
        uuid.UUID(initial[0]["id"]),
    )


async def _material(
    stack: DbStack, base: uuid.UUID, source: uuid.UUID
) -> tuple[uuid.UUID, uuid.UUID]:
    async with stack.sessions() as session:
        doc = KnowledgeDocument(
            base_id=base,
            source_id=source,
            external_ref="old.md",
            object_key="old.md",
            title="历史资料.md",
            media_type="text/markdown",
            byte_size=12,
            content_hash=hashlib.sha256(b"old snapshot").hexdigest(),
            status="ready",
            chunk_count=1,
        )
        session.add(doc)
        await session.flush()
        chunk = KnowledgeChunk(
            base_id=base, document_id=doc.id, ordinal=0, text="保留的引用原文"
        )
        session.add(chunk)
        await session.commit()
        return doc.id, chunk.id


async def test_imported_source_can_edit_display_and_paging(
    db_stack: DbStack,
) -> None:
    client = db_stack.client
    base, source, _ = await _created(client)
    path = f"{SOURCES}/{source}"
    before = await client.patch(
        path,
        json={
            "config": {"path": "/api/v1/platform/old", "id_field": "record_id"}
        },
    )
    assert before.status_code == 200
    assert before.json()["data"]["can_change_identity"] is True
    await _material(db_stack, base, source)
    changed = await client.patch(
        path,
        json={
            "name": "新显示名",
            "config": {
                "title_field": "label",
                "page_param": "p",
                "size_param": "n",
            },
        },
    )
    assert changed.status_code == 200
    data = changed.json()["data"]
    assert data["name"] == "新显示名"
    assert data["can_change_identity"] is False
    assert data["config"] == {
        "path": "/api/v1/platform/old",
        "id_field": "record_id",
        "title_field": "label",
        "page_param": "p",
        "size_param": "n",
    }
    for body in ({"path": "/api/v1/platform/other"}, {"id_field": "different"}):
        rejected = await client.patch(
            path, json={"name": "不应写入", "config": body}
        )
        assert (rejected.status_code, rejected.json()["code"]) == (409, 42337)
    listed = (await client.get(f"{BASES}/{base}/sources")).json()["data"]
    assert (
        next(s["name"] for s in listed if s["id"] == str(source)) == "新显示名"
    )


async def test_detaching_stops_sync_and_keeps_documents_and_citations(
    db_stack: DbStack,
) -> None:
    client = db_stack.client
    base, source, _ = await _created(client)
    doc, chunk = await _material(db_stack, base, source)
    path = f"{SOURCES}/{source}"
    assert (await client.delete(path)).status_code == 204
    assert (await client.delete(path)).status_code == 204
    listed = (await client.get(f"{BASES}/{base}/sources")).json()["data"]
    assert [s["kind"] for s in listed] == ["upload"]
    assert listed[0]["can_change_identity"] is False
    assert (await client.post(path + ":sync", json={})).status_code == 404
    assert (
        await client.patch(path, json={"name": "已解绑"})
    ).status_code == 404
    assert (await client.get(f"{BASES}/{base}")).json()["data"][
        "document_count"
    ] == 1
    window = await client.get(f"{BASES}/{base}/chunks/{chunk}")
    assert window.status_code == 200
    assert window.json()["data"]["text"] == "保留的引用原文"
    async with db_stack.sessions() as session:
        stored = await session.get(KnowledgeDocument, doc)
        citation = await session.get(KnowledgeChunk, chunk)
        original = await session.get(KnowledgeSource, source)
        assert original is not None
        assert original.detached_at is not None
        assert stored is not None
        assert stored.object_key == "old.md"
        assert citation is not None
        assert citation.text == "保留的引用原文"


async def test_only_admins_manage_platform_sources(
    db_client: httpx.AsyncClient, sign: HeaderFactory
) -> None:
    _, source, upload = await _created(db_client)
    for codes in (["knowledge:use"], ["knowledge:write"]):
        headers = sign(codes)
        assert (
            await db_client.patch(
                f"{SOURCES}/{source}", json={"name": "编辑"}, headers=headers
            )
        ).status_code == 403
        assert (
            await db_client.delete(f"{SOURCES}/{source}", headers=headers)
        ).status_code == 403
    for suffix in (str(upload), str(uuid.uuid4())):
        expected = 409 if suffix == str(upload) else 404
        assert (
            await db_client.patch(f"{SOURCES}/{suffix}", json={"name": "test"})
        ).status_code == expected
        assert (
            await db_client.delete(f"{SOURCES}/{suffix}")
        ).status_code == expected
    invalid = await db_client.patch(
        f"{SOURCES}/{source}",
        json={"config": {"path": "https://example.invalid/synthetic"}},
    )
    assert invalid.status_code == 400


async def test_legacy_source_adapter_stops_before_any_upstream_request(
    db_stack: DbStack,
) -> None:
    _, source, _ = await _created(db_stack.client)
    assert (
        await db_stack.client.delete(f"{SOURCES}/{source}")
    ).status_code == 204
    async with db_stack.sessions() as session:
        row = await session.get(KnowledgeSource, source)
        assert row is not None
        config = dict(row.config_json)
    calls: list[str] = []

    def upstream(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        return httpx.Response(200, json={"data": {"items": []}})

    async with httpx.AsyncClient(
        base_url="http://local-fixture", transport=httpx.MockTransport(upstream)
    ) as client:
        adapter = PlatformSource(client, {})
        with pytest.raises(ValidationFailed):
            await adapter.discover(config, None)
    assert calls == []
    assert config["last_active_config"]["path"] == "/api/v1/platform/items"
