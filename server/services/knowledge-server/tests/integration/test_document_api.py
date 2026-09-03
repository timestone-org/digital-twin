"""文档的读写面，打真库。直传两步与摄取排队都在这里验。"""

import uuid
from collections.abc import Callable
from typing import Any

import httpx
import pytest

from knowledge_server.apps.knowledge import crud
from knowledge_server.settings import API_PREFIX

pytestmark = pytest.mark.requires_postgres

BASES = f"{API_PREFIX}/knowledge-bases"
DOCS = f"{API_PREFIX}/documents"


async def _base(client: httpx.AsyncClient) -> str:
    response = await client.post(BASES, json={"name": "手册库"})
    return str(response.json()["data"]["id"])


async def _uploaded(
    client: httpx.AsyncClient, base_id: str, filename: str = "手册.md"
) -> dict:
    ticket = await client.post(
        f"{DOCS}:upload-ticket",
        params={"base_id": base_id},
        json={"filename": filename, "size_bytes": 12},
    )
    assert ticket.status_code == httpx.codes.CREATED, ticket.text
    made = ticket.json()["data"]
    registered = await client.post(
        DOCS,
        params={"base_id": base_id},
        json={"document_id": made["document_id"], "filename": filename},
    )
    assert registered.status_code == httpx.codes.CREATED, registered.text
    return registered.json()["data"]


async def test_a_ticket_pins_the_key_before_any_row_exists(
    db_client: httpx.AsyncClient,
) -> None:
    """⚠ 签凭证那一步**不落行**：没传成的文档不会在库里留下半条记录，
    界面上也就不会出现一份永远停在 pending 的鬼影。"""
    base_id = await _base(db_client)
    ticket = await db_client.post(
        f"{DOCS}:upload-ticket",
        params={"base_id": base_id},
        json={"filename": "手册.md", "size_bytes": 12},
    )
    made = ticket.json()["data"]
    assert made["object_key"].endswith(".md")
    listed = await db_client.get(DOCS, params={"base_id": base_id})
    assert listed.json()["data"]["total"] == 0


async def test_an_unsupported_format_is_refused_before_the_upload(
    db_client: httpx.AsyncClient,
) -> None:
    """⚠ 让用户传完 200 MB 再说「不收这种格式」是两次浪费，
    而第二次那句错还夹在异步管线里。"""
    base_id = await _base(db_client)
    response = await db_client.post(
        f"{DOCS}:upload-ticket",
        params={"base_id": base_id},
        json={"filename": "图纸.pdf", "size_bytes": 12},
    )
    assert response.status_code == httpx.codes.UNSUPPORTED_MEDIA_TYPE
    assert response.json()["code"] == 42302


async def test_registering_starts_the_document_at_pending(
    db_client: httpx.AsyncClient,
) -> None:
    base_id = await _base(db_client)
    made = await _uploaded(db_client, base_id)
    assert made["status"] == "pending"
    assert made["title"] == "手册.md"
    assert made["byte_size"] > 0


async def test_the_same_content_twice_is_refused(
    db_client: httpx.AsyncClient,
) -> None:
    """⚠ 判据是内容哈希而不是文件名：文件名一改就当成新文档，是最常见的
    重复来源，而重复的表现是同一段话在检索里出现两次。"""
    base_id = await _base(db_client)
    await _uploaded(db_client, base_id, "甲.md")
    ticket = await db_client.post(
        f"{DOCS}:upload-ticket",
        params={"base_id": base_id},
        json={"filename": "乙.md", "size_bytes": 12},
    )
    second = await db_client.post(
        DOCS,
        params={"base_id": base_id},
        json={
            "document_id": ticket.json()["data"]["document_id"],
            "filename": "乙.md",
        },
    )
    assert second.status_code == httpx.codes.CONFLICT
    assert second.json()["code"] == 42308


async def test_registering_queues_an_ingest_job(
    db_stack: object, db_client: httpx.AsyncClient
) -> None:
    """⚠ 投递必须在事务**提交之后**：提交前投出去的话，worker 可能先于提交
    读到，那时文档行还不存在。"""
    base_id = await _base(db_client)
    await _uploaded(db_client, base_id)
    stream = (
        db_stack.app.state.container.stream
    )  # pyright: ignore[reportAttributeAccessIssue]
    assert len(stream.sent) == 1
    assert stream.sent[0]["traceparent"]


async def test_listing_can_filter_by_status(
    db_client: httpx.AsyncClient,
) -> None:
    base_id = await _base(db_client)
    await _uploaded(db_client, base_id)
    hit = await db_client.get(
        DOCS, params={"base_id": base_id, "status": "pending"}
    )
    miss = await db_client.get(
        DOCS, params={"base_id": base_id, "status": "ready"}
    )
    assert hit.json()["data"]["total"] == 1
    assert miss.json()["data"]["total"] == 0


async def test_an_unknown_status_filter_is_refused(
    db_client: httpx.AsyncClient,
) -> None:
    """⚠ 当成「不筛」的表现是「筛了跟没筛一样」，而用户会以为这个库里
    所有文档都是这个状态。"""
    base_id = await _base(db_client)
    response = await db_client.get(
        DOCS, params={"base_id": base_id, "status": "乱写的"}
    )
    assert response.status_code == httpx.codes.BAD_REQUEST
    assert response.json()["code"] == 42307


async def test_reparse_puts_it_back_in_the_queue(
    db_stack: object, db_client: httpx.AsyncClient
) -> None:
    """⚠ 这是这条链路上唯一的重试入口，而且它由人按。"""
    base_id = await _base(db_client)
    made = await _uploaded(db_client, base_id)
    response = await db_client.post(f"{DOCS}/{made['id']}:reparse")
    assert response.status_code == httpx.codes.OK
    stream = (
        db_stack.app.state.container.stream
    )  # pyright: ignore[reportAttributeAccessIssue]
    assert len(stream.sent) == 2


async def test_deleting_removes_the_row_then_the_bytes(
    db_stack: object, db_client: httpx.AsyncClient
) -> None:
    """⚠ 顺序不能反：先清对象再删行的话，删行失败会留下一行指着不存在的
    原件，而它看起来是一份正常文档。"""
    base_id = await _base(db_client)
    made = await _uploaded(db_client, base_id)
    dropped = await db_client.delete(f"{DOCS}/{made['id']}")
    assert dropped.status_code == httpx.codes.NO_CONTENT
    store = (
        db_stack.app.state.container.objectstore
    )  # pyright: ignore[reportAttributeAccessIssue]
    assert store.deleted
    after = await db_client.get(f"{DOCS}/{made['id']}")
    assert after.status_code == httpx.codes.NOT_FOUND


async def test_a_missing_document_is_404(
    db_client: httpx.AsyncClient,
) -> None:
    response = await db_client.get(f"{DOCS}/{uuid.uuid4()}")
    assert response.status_code == httpx.codes.NOT_FOUND
    assert response.json()["code"] == 42303


async def test_counting_documents_groups_by_base_in_one_query(
    db_client: httpx.AsyncClient, db_sessions: Callable[[], Any]
) -> None:
    """⚠ 一次查完再按库分组，不逐个库查：库清单一页十来个，逐个查就是十来个
    往返，而这一格只是列表上的一行字。"""
    base_id = await _base(db_client)
    await _uploaded(db_client, base_id)

    async with db_sessions() as session:
        made = await crud.document.counts_by_base(session, [uuid.UUID(base_id)])

    assert made == {uuid.UUID(base_id): 1}


async def test_counting_nothing_asks_the_database_nothing(
    db_sessions: Callable[[], Any],
) -> None:
    """⚠ 空清单直接回空表：一页库都没有时还去打一次库是白费的往返。"""
    async with db_sessions() as session:
        assert await crud.document.counts_by_base(session, []) == {}
