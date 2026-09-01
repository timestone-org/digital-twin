"""库与来源的读写面，打真库。"""

import uuid

import httpx
import pytest

from knowledge_server.settings import API_PREFIX

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
        json={"kind": "dataset", "name": "台账", "config": {"table": "t"}},
    )
    assert response.status_code == httpx.codes.CREATED
    assert response.json()["data"]["config"] == {"table": "t"}


async def test_sources_of_a_missing_base_are_404(
    db_client: httpx.AsyncClient,
) -> None:
    response = await db_client.get(f"{BASES}/{uuid.uuid4()}/sources")
    assert response.status_code == httpx.codes.NOT_FOUND
