"""原文块按库鉴权和有界续读，窗口不丢字、不重复。"""

import uuid

import pytest
from integration.conftest import DbStack, HeaderFactory
from integration.test_search_api import _base, _uploaded

from knowledge_server.apps.knowledge.models import KnowledgeChunk

pytestmark = pytest.mark.requires_postgres


async def test_chunk_windows_preserve_text_and_reject_a_different_base(
    db_stack: DbStack,
    sign: HeaderFactory,
) -> None:
    base_id = uuid.UUID(await _base(db_stack.client))
    document_id = uuid.UUID(await _uploaded(db_stack.client, str(base_id)))
    chunk_id = uuid.uuid4()
    text = "甲" * 1200 + "尾段重要条件"
    async with db_stack.sessions() as session:
        session.add(
            KnowledgeChunk(
                id=chunk_id,
                base_id=base_id,
                document_id=document_id,
                ordinal=0,
                text=text,
                locator_json={"label": "第1页"},
            )
        )
        await session.commit()
    url = f"/api/v1/knowledge/knowledge-bases/{base_id}/chunks/{chunk_id}"
    first = await db_stack.client.get(url, params={"limit": 1200})
    assert first.status_code == 200
    data = first.json()["data"]
    assert data["has_more"] is True
    second = await db_stack.client.get(
        url, params={"offset": data["next_offset"], "limit": 1200}
    )
    assert data["text"] + second.json()["data"]["text"] == text
    assert second.json()["data"]["has_more"] is False
    assert second.json()["data"]["locator"]["label"] == "第1页"
    wrong = await db_stack.client.get(
        url.replace(str(base_id), str(uuid.uuid4()))
    )
    assert wrong.status_code == 404
    denied = await db_stack.client.get(
        url, headers=sign(codes=(), role="viewer")
    )
    assert denied.status_code == 403
    invalid = await db_stack.client.get(url, params={"limit": 8001})
    assert invalid.status_code == 400
