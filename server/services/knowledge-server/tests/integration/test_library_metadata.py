"""知识库管理元数据的部分更新与现有索引状态。"""

import uuid

import httpx
import pytest
from integration.conftest import DbStack, HeaderFactory
from integration.test_reembedding_worker import local_space

from knowledge_server.apps.knowledge.api import reembeddings
from knowledge_server.apps.knowledge.models import KnowledgeBase
from knowledge_server.settings import API_PREFIX

pytestmark = pytest.mark.requires_postgres
BASES = f"{API_PREFIX}/knowledge-bases"


async def test_partial_metadata_updates_keep_published_identity(
    db_stack: DbStack,
) -> None:
    client = db_stack.client
    created = await client.post(
        BASES, json={"name": "原库名", "description": "原描述"}
    )
    assert created.status_code == 201
    before = created.json()["data"]
    path = f"{BASES}/{before['id']}"
    async with db_stack.sessions() as session:
        row = await session.get(KnowledgeBase, uuid.UUID(before["id"]))
        assert row is not None
        generation = row.active_embedding_generation_id
        revision = row.content_revision
    renamed = await client.patch(path, json={"name": "新库名"})
    assert renamed.status_code == 200
    result = renamed.json()["data"]
    assert result["name"] == "新库名"
    assert result["description"] == "原描述"
    for key in (
        "id",
        "owner_id",
        "embedding_model",
        "dimensions",
        "vector_status",
        "retrieval_strategy",
        "document_count",
    ):
        assert result[key] == before[key]
    cleared = await client.patch(path, json={"description": ""})
    assert cleared.status_code == 200
    shown = (await client.get(path)).json()["data"]
    assert shown["name"] == "新库名"
    assert shown["description"] == ""
    async with db_stack.sessions() as session:
        row = await session.get(KnowledgeBase, uuid.UUID(before["id"]))
        assert row is not None
        assert row.active_embedding_generation_id == generation
        assert row.content_revision == revision


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"name": " "},
        {"name": None, "description": "保留"},
        {"description": None},
        {"embedding_model": "另一个模型"},
        {"name": "名" * 121},
        {"description": "改" * 1001},
    ],
)
async def test_only_valid_library_metadata_is_accepted(
    db_client: httpx.AsyncClient, payload: dict[str, object]
) -> None:
    new = (await db_client.post(BASES, json={"name": "原库名"})).json()["data"]
    response = await db_client.patch(f"{BASES}/{new['id']}", json=payload)
    assert response.status_code == 400
    assert response.json()["code"] == 40001
    assert (await db_client.get(f"{BASES}/{new['id']}")).json()["data"][
        "name"
    ] == "原库名"


async def test_only_library_managers_can_edit(
    db_client: httpx.AsyncClient, sign: HeaderFactory
) -> None:
    path = f"{BASES}/{uuid.uuid4()}"
    for codes in (["knowledge:use"], ["knowledge:write"]):
        response = await db_client.patch(
            path, json={"name": "无权修改"}, headers=sign(codes)
        )
        assert response.status_code == 403
    missing = await db_client.patch(
        path, json={"name": "管理修改"}, headers=sign(["knowledge:manage"])
    )
    assert missing.status_code == 404
    assert missing.json()["code"] == 42301


async def test_editing_metadata_preserves_an_approved_reembedding_preview(
    db_stack: DbStack,
    db_dimensions: int,
) -> None:
    db_stack.app.dependency_overrides[reembeddings.target] = (
        lambda: local_space(db_dimensions)
    )
    client = db_stack.client
    new = (await client.post(BASES, json={"name": "预览库"})).json()["data"]
    path = f"{BASES}/{new['id']}"
    jobs = path + "/reembeddings"
    preview = (await client.post(jobs + ":preview", json={})).json()["data"]
    edited = await client.patch(
        path, json={"name": "名" * 120, "description": "改" * 1000}
    )
    assert edited.status_code == 200
    started = await client.post(
        jobs,
        headers={"Idempotency-Key": "approved-before-rename"},
        json={
            "target_space_id": preview["target_space_id"],
            "expected_revision": preview["content_revision"],
        },
    )
    assert started.status_code == 202
    assert started.json()["data"]["base_id"] == new["id"]
    assert started.json()["data"]["status"] == "pending"
