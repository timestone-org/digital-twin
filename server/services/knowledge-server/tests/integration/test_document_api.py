"""文档的读写面，打真库。直传两步与摄取排队都在这里验。"""

import hashlib
import uuid
from collections.abc import Callable
from typing import Any

import httpx
import pytest

from knowledge_server.apps.knowledge import crud
from knowledge_server.settings import API_PREFIX
from lib.objectstore import ObjectNotFound

pytestmark = pytest.mark.requires_postgres

BASES = f"{API_PREFIX}/knowledge-bases"
DOCS = f"{API_PREFIX}/documents"
# 假对象存储在「浏览器传上去了」那一步落下的字节（见 integration/conftest.py）
FAKE_UPLOAD_BYTES = "# 标题\n正文".encode()


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


async def test_reading_the_original_streams_it_with_a_content_etag(
    db_client: httpx.AsyncClient,
) -> None:
    """⚠ 流字节而不是发预签名 URL，与图那条同源：预签名一旦生成就是一条
    「谁拿到谁能看」的链接，而知识库里可能有涉密图纸。"""
    base_id = await _base(db_client)
    made = await _uploaded(db_client, base_id)

    response = await db_client.get(f"{DOCS}/{made['id']}/raw")

    assert response.status_code == httpx.codes.OK
    assert response.content == FAKE_UPLOAD_BYTES
    assert response.headers["content-type"] == "text/markdown; charset=utf-8"
    # ⚠ ETag 是**内容哈希**而不是时间戳：重新解析之后哈希不变，浏览器那份
    # 缓存因此仍然有效；按时间戳的话每次重新解析都要把原件重下一遍
    digest = hashlib.sha256(FAKE_UPLOAD_BYTES).hexdigest()
    assert response.headers["etag"] == f'"{digest}"'
    # ⚠ 只能是 private：原件是某个库里的内容，不许被共享缓存留下来
    assert response.headers["cache-control"].startswith("private")
    assert response.headers["content-disposition"].startswith("inline")


async def test_the_original_carries_the_two_guard_headers(
    db_client: httpx.AsyncClient,
) -> None:
    """⚠ 两条都不能省：`nosniff` 挡住「声明成文本、浏览器嗅成 HTML 去执行」，
    `sandbox` 让万一真被当成文档渲染的那一份跑在不透明源上、脚本不执行。"""
    base_id = await _base(db_client)
    made = await _uploaded(db_client, base_id)

    response = await db_client.get(f"{DOCS}/{made['id']}/raw")

    assert response.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in response.headers["content-security-policy"]


async def test_an_html_original_is_never_served_inline(
    db_client: httpx.AsyncClient,
) -> None:
    """⚠ 安全边界：把用户传上来的 HTML 以 inline 摊在本站域名下，那份 HTML
    里的脚本就跑在本站源上，能读这个源的存储、能替用户调接口。"""
    base_id = await _base(db_client)
    made = await _uploaded(db_client, base_id, "坏页面.html")

    response = await db_client.get(f"{DOCS}/{made['id']}/raw")

    assert response.status_code == httpx.codes.OK
    assert response.headers["content-disposition"].startswith("attachment")


async def test_a_chinese_filename_survives_the_response_header(
    db_client: httpx.AsyncClient,
) -> None:
    """⚠ 响应头按 latin-1 编码，一个中文名会让整条响应在编码那一步炸掉，
    而炸的地方离「文件名」三个字很远。"""
    base_id = await _base(db_client)
    made = await _uploaded(db_client, base_id, "冷却水系统手册.md")

    response = await db_client.get(f"{DOCS}/{made['id']}/raw")

    assert response.status_code == httpx.codes.OK
    disposition = response.headers["content-disposition"]
    assert "filename*=UTF-8''" in disposition
    assert disposition.isascii()


async def test_a_document_without_an_original_is_reported_apart(
    db_client: httpx.AsyncClient, db_sessions: Callable[[], Any]
) -> None:
    """⚠ 外部系统那一路的一行压根没有过原件，而它明明就在那张表里列着——
    混成「没有这份文档」的话，用户只会觉得界面在自相矛盾。"""
    base_id = await _base(db_client)
    document_id = uuid.uuid4()
    async with db_sessions() as session:
        source = await crud.source.find_source_by_kind(
            session, uuid.UUID(base_id), "upload"
        )
        assert source is not None
        await crud.document.insert_document(
            session,
            crud.document.DocumentWrite(
                document_id=document_id,
                base_id=uuid.UUID(base_id),
                source_id=source.id,
                external_ref="ems:record:42",
                title="外部系统里的一条记录",
                media_type="",
                object_key="",
                byte_size=0,
                content_hash="d" * 64,
            ),
        )

    response = await db_client.get(f"{DOCS}/{document_id}/raw")

    assert response.status_code == httpx.codes.NOT_FOUND
    assert response.json()["code"] == 42311
    listed = await db_client.get(f"{DOCS}/{document_id}")
    assert listed.json()["data"]["has_raw"] is False


async def test_an_uploaded_document_says_it_has_an_original(
    db_client: httpx.AsyncClient,
) -> None:
    """⚠ 前端靠这一格决定摆不摆预览入口。让它去推「有没有 media_type」的话，
    上传那一路登记时留的是空串，推出来的结论会是「一份原件都没有」。"""
    base_id = await _base(db_client)
    made = await _uploaded(db_client, base_id)
    assert made["has_raw"] is True


async def test_an_original_whose_bytes_are_gone_is_reported_apart(
    db_stack: Any, db_client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """⚠ 与「没有原件」分开报：行还在而字节没了意味着桶被清过，
    那是运维要知道的事。"""
    base_id = await _base(db_client)
    made = await _uploaded(db_client, base_id)

    async def _gone(key: str) -> bytes:
        raise ObjectNotFound(f"没有 {key}")

    monkeypatch.setattr(
        db_stack.app.state.container.objectstore, "get_bytes", _gone
    )
    response = await db_client.get(f"{DOCS}/{made['id']}/raw")

    assert response.status_code == httpx.codes.GONE
    assert response.json()["code"] == 42312
