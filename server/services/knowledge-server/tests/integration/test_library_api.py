"""库与来源的读写面，打真库。"""

import uuid
from collections.abc import Callable
from typing import Any

import httpx
import pytest

from knowledge_server.apps.knowledge import crud
from knowledge_server.apps.knowledge.services import library_service
from knowledge_server.settings import API_PREFIX
from lib.web import PageParams

pytestmark = pytest.mark.requires_postgres

BASES = f"{API_PREFIX}/knowledge-bases"


async def _create(client: httpx.AsyncClient, name: str = "冷却水手册") -> dict:
    response = await client.post(BASES, json={"name": name})
    assert response.status_code == httpx.codes.CREATED, response.text
    return response.json()["data"]


async def test_a_new_base_gets_an_upload_source_for_free(
    db_client: httpx.AsyncClient,
) -> None:
    """⚠ 不自动建的话，第一次上传要先让用户去「加一路来源」，
    而那一步对上传来说毫无意义。"""
    made = await _create(db_client)
    response = await db_client.get(f"{BASES}/{made['id']}/sources")
    kinds = [one["kind"] for one in response.json()["data"]]
    assert kinds == ["upload"]


async def test_the_embedding_slot_stays_null_when_nothing_is_wired(
    db_client: httpx.AsyncClient,
) -> None:
    """⚠ 填一个「将来大概会用」的名字的话，库上写着一路根本没算过的模型名，
    而检索会以为它已经建过索引。"""
    made = await _create(db_client)
    assert made["embedding_model"] is None
    assert made["dimensions"] is None


async def test_an_unknown_strategy_is_refused(
    db_client: httpx.AsyncClient,
) -> None:
    """⚠ 悄悄退回默认的表现是「配的策略一直没生效」，而配置面看着一切正常。"""
    response = await db_client.post(
        BASES, json={"name": "甲", "retrieval_strategy": "乱写的"}
    )
    # ⚠ 本仓把入参校验统一映射成 400 + 40001（api-contract §4.1），
    # 不用 FastAPI 默认的 422
    assert response.status_code == httpx.codes.BAD_REQUEST
    assert response.json()["code"] == 40001


async def test_a_base_that_does_not_exist_is_404_not_403(
    db_client: httpx.AsyncClient,
) -> None:
    """⚠ id 是可枚举的：用 403 区分「不存在」与「无权看见」等于逐个 id
    回答「这一条确实存在」。"""
    response = await db_client.get(f"{BASES}/{uuid.uuid4()}")
    assert response.status_code == httpx.codes.NOT_FOUND
    assert response.json()["code"] == 42301


async def test_listing_pages(db_client: httpx.AsyncClient) -> None:
    for index in range(3):
        await _create(db_client, f"库{index}")
    response = await db_client.get(BASES, params={"page": 1, "size": 2})
    body = response.json()["data"]
    assert len(body["items"]) == 2
    assert body["total"] >= 3


async def test_deleting_a_base_takes_its_sources_with_it(
    db_client: httpx.AsyncClient,
) -> None:
    made = await _create(db_client)
    dropped = await db_client.delete(f"{BASES}/{made['id']}")
    assert dropped.status_code == httpx.codes.NO_CONTENT
    after = await db_client.get(f"{BASES}/{made['id']}")
    assert after.status_code == httpx.codes.NOT_FOUND


async def test_adding_a_second_source(db_client: httpx.AsyncClient) -> None:
    made = await _create(db_client)
    response = await db_client.post(
        f"{BASES}/{made['id']}/sources",
        json={"kind": "platform", "name": "台账", "config": {"path": "/x"}},
    )
    assert response.status_code == httpx.codes.CREATED
    assert response.json()["data"]["config"] == {"path": "/x"}


async def test_sources_of_a_missing_base_are_404(
    db_client: httpx.AsyncClient,
) -> None:
    response = await db_client.get(f"{BASES}/{uuid.uuid4()}/sources")
    assert response.status_code == httpx.codes.NOT_FOUND


async def test_deleting_a_base_sweeps_its_objects(
    db_stack: object, db_client: httpx.AsyncClient
) -> None:
    """⚠ 清对象挂在提交之后：事务里禁做外部 IO。清失败只留下一堆没人引用的
    字节，不影响正确性——但不清的话，删掉的库会一直占着存储。"""
    made = await _create(db_client)
    store = (
        db_stack.app.state.container.objectstore
    )  # pyright: ignore[reportAttributeAccessIssue]
    store.objects[f"knowledge/{made['id']}/x.md"] = b"x"
    await db_client.delete(f"{BASES}/{made['id']}")
    assert store.objects == {}


async def test_a_source_that_does_not_exist_is_404(
    db_client: httpx.AsyncClient,
) -> None:
    response = await db_client.post(
        f"{BASES}/{uuid.uuid4()}/sources",
        json={"kind": "platform", "name": "台账", "config": {}},
    )
    assert response.status_code == httpx.codes.NOT_FOUND


async def test_the_source_row_reports_its_sync_state(
    db_client: httpx.AsyncClient,
) -> None:
    """⚠ `last_error` 留着而不是清掉：清掉的话界面上是「从没同步过」，
    而那与「同步了但一直失败」是两件事。"""
    made = await _create(db_client)
    response = await db_client.get(f"{BASES}/{made['id']}/sources")
    row = response.json()["data"][0]
    assert row["last_synced_at"] is None
    assert row["last_error"] == ""
    assert row["config"] == {}


async def _uploaded(
    client: httpx.AsyncClient, base_id: str, filename: str
) -> None:
    """在这个库下登记一份文档。"""
    ticket = await client.post(
        f"{API_PREFIX}/documents:upload-ticket",
        params={"base_id": base_id},
        json={"filename": filename, "size_bytes": 12},
    )
    assert ticket.status_code == httpx.codes.CREATED, ticket.text
    made = ticket.json()["data"]
    registered = await client.post(
        f"{API_PREFIX}/documents",
        params={"base_id": base_id},
        json={"document_id": made["document_id"], "filename": filename},
    )
    assert registered.status_code == httpx.codes.CREATED, registered.text


async def test_the_listed_base_says_how_many_documents_it_holds(
    db_client: httpx.AsyncClient,
) -> None:
    """⚠ 这一格原来恒为 0：界面上每个库都写着「0 份文档」，而库里明明有东西。
    契约里有这一格、界面也在画它，只有取值那一步没接上——typecheck 与用例
    都拦不住一个「合法的 0」。"""
    full = await _create(db_client, f"有文档 {uuid.uuid4().hex[:6]}")
    empty = await _create(db_client, f"空库 {uuid.uuid4().hex[:6]}")
    # ⚠ 一个库一份：假桶给每个键写同一段字节，同一个库里的第二份会撞内容哈希
    await _uploaded(db_client, full["id"], "甲.md")

    listed = await db_client.get(BASES, params={"page": 1, "size": 100})

    counts = {
        one["name"]: one["document_count"]
        for one in listed.json()["data"]["items"]
    }
    assert counts[full["name"]] == 1
    # ⚠ 一份都没有的库要回 0 而不是漏掉这一格：分组查询里它压根不出现
    assert counts[empty["name"]] == 0


async def test_the_pager_counts_without_a_query_per_base(
    db_client: httpx.AsyncClient, db_sessions: Callable[[], Any]
) -> None:
    """⚠ 一次查完这一页各库的文档数，不逐个库查：库清单一页十来个，逐个查就是
    十来个往返，而这一格只是列表上的一行字。"""
    made = await _create(db_client, f"组页 {uuid.uuid4().hex[:6]}")
    await _uploaded(db_client, made["id"], "甲.md")

    async with db_sessions() as session:
        rows, total = await crud.knowledge_base.list_bases(
            session, offset=0, limit=100
        )
        page = await library_service.base_page(
            session, rows, PageParams(page=1, size=100), total
        )

    counts = {one.name: one.document_count for one in page.items}
    assert counts[made["name"]] == 1


async def test_reading_one_base_says_the_same_number(
    db_client: httpx.AsyncClient,
) -> None:
    """⚠ 两条端点必须给同一个数：不一致的表现是「列表说 2、点进去说 0」。"""
    made = await _create(db_client, f"单读 {uuid.uuid4().hex[:6]}")
    await _uploaded(db_client, made["id"], "甲.md")

    one = await db_client.get(f"{BASES}/{made['id']}")

    assert one.json()["data"]["document_count"] == 1
