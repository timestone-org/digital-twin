"""台账的建改删读：编码是身份且不可改，删表要先面对底下的历史行。

⚠ 这条链上有两处「不报错但错」：`code` 混进更新入参（大屏绑定键 `ds:{code}:…`
会集体失效），以及删表不清行（超表上没有外键可以级联，留下的是一批永远查不到、
也再没人清理的孤儿行）。
"""

import uuid
from typing import Any

import httpx
import pytest
from conftest import AppContext
from sqlalchemy.ext.asyncio import AsyncSession

from integration.dataset_helpers import (
    HTTP_BAD_REQUEST,
    HTTP_CONFLICT,
    HTTP_CREATED,
    HTTP_NO_CONTENT,
    HTTP_NOT_FOUND,
    TABLES,
    code_of,
    create_table,
    data_of,
    table_body,
)
from lib.utils.ids import uuid7
from lib.utils.timeutils import utcnow
from platform_server.apps.dataset.crud import record_crud
from platform_server.apps.dataset.models import DatasetRecord

pytestmark = pytest.mark.requires_postgres

TABLE_CODE_TAKEN = 41203
TABLE_NOT_EMPTY = 41205


async def _seed_record(session: AsyncSession, table_id: str) -> None:
    """直接落一行台账数据。录入端点随第 3 期落地，用例先自己种。"""
    session.add(
        DatasetRecord(
            table_id=uuid.UUID(table_id),
            ts=utcnow(),
            row_id=uuid7(),
            values_json={"产量": 12},
            source="manual",
        )
    )
    await session.commit()


async def test_a_new_table_is_created_with_a_location_header(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.post(TABLES, json=table_body())

    assert response.status_code == HTTP_CREATED
    created = data_of(response)
    assert response.headers["Location"] == f"{TABLES}/{created['id']}"
    assert created["code"] == "shift_output"
    assert created["columns"] == []


async def test_a_new_table_defaults_to_manual_collection_and_no_retention(
    app_client: httpx.AsyncClient,
) -> None:
    created = await create_table(app_client)

    assert created["collect_mode"] == "manual"
    # 空表示永久保留（D7）
    assert created["retention_days"] is None
    assert created["last_collected_ts"] is None


async def test_a_duplicate_code_is_a_conflict(
    app_client: httpx.AsyncClient,
) -> None:
    await create_table(app_client)

    response = await app_client.post(TABLES, json=table_body())

    assert response.status_code == HTTP_CONFLICT
    assert code_of(response) == TABLE_CODE_TAKEN


async def test_the_same_idempotency_key_creates_one_table(
    app_client: httpx.AsyncClient,
) -> None:
    headers = {"Idempotency-Key": "once"}
    first = await app_client.post(TABLES, json=table_body(), headers=headers)
    second = await app_client.post(TABLES, json=table_body(), headers=headers)

    assert second.status_code == HTTP_CREATED
    assert data_of(first)["id"] == data_of(second)["id"]


async def test_the_listing_filters_by_keyword(
    app_client: httpx.AsyncClient,
) -> None:
    await create_table(app_client, code="energy", name="用电台账")
    await create_table(app_client, code="water", name="用水台账")

    response = await app_client.get(TABLES, params={"q": "用电"})

    assert [item["code"] for item in data_of(response)["items"]] == ["energy"]


async def test_the_listing_counts_the_columns_of_each_table(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 列数是批量查出来的，逐行发查询会让列表页在几十张台账上变成 N+1
    table = await create_table(app_client)
    await app_client.post(
        f"{TABLES}/{table['id']}/columns",
        json={"key": "产量", "name": "产量"},
    )

    response = await app_client.get(TABLES)

    assert [item["column_count"] for item in data_of(response)["items"]] == [1]


async def test_a_keyword_matching_nothing_yields_an_empty_page(
    app_client: httpx.AsyncClient,
) -> None:
    await create_table(app_client)

    response = await app_client.get(TABLES, params={"q": "对不上的关键字"})

    assert data_of(response)["items"] == []
    assert data_of(response)["total"] == 0


async def test_the_detail_carries_the_column_definitions(
    app_client: httpx.AsyncClient,
) -> None:
    table = await create_table(app_client)
    await app_client.post(
        f"{TABLES}/{table['id']}/columns",
        json={"key": "产量", "name": "产量"},
    )

    response = await app_client.get(f"{TABLES}/{table['id']}")

    detail = data_of(response)
    assert [column["key"] for column in detail["columns"]] == ["产量"]
    assert detail["column_count"] == 1


async def test_an_unknown_table_is_not_found(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(f"{TABLES}/{uuid7()}")

    assert response.status_code == HTTP_NOT_FOUND


async def test_updating_a_table_leaves_the_untouched_fields_alone(
    app_client: httpx.AsyncClient,
) -> None:
    table = await create_table(app_client)

    response = await app_client.patch(
        f"{TABLES}/{table['id']}", json={"name": "改过的名字"}
    )

    updated = data_of(response)
    assert updated["name"] == "改过的名字"
    assert updated["code"] == table["code"]


async def test_the_code_cannot_be_changed_through_the_update_payload(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ `code` 是大屏绑定键的前半段，改一次等于让每一处引用它的绑定悄悄失效
    table = await create_table(app_client)

    response = await app_client.patch(
        f"{TABLES}/{table['id']}", json={"code": "another"}
    )

    assert response.status_code == HTTP_BAD_REQUEST


async def test_an_explicit_null_on_a_not_null_field_is_rejected(
    app_client: httpx.AsyncClient,
) -> None:
    table = await create_table(app_client)

    response = await app_client.patch(
        f"{TABLES}/{table['id']}", json={"name": None}
    )

    assert response.status_code == HTTP_BAD_REQUEST


async def test_an_explicit_null_clears_the_retention(
    app_client: httpx.AsyncClient,
) -> None:
    table = await create_table(app_client, retention_days=30)

    response = await app_client.patch(
        f"{TABLES}/{table['id']}", json={"retention_days": None}
    )

    assert data_of(response)["retention_days"] is None


async def test_an_empty_table_is_deleted_without_force(
    app_client: httpx.AsyncClient,
) -> None:
    table = await create_table(app_client)

    response = await app_client.delete(f"{TABLES}/{table['id']}")

    assert response.status_code == HTTP_NO_CONTENT
    assert (
        await app_client.get(f"{TABLES}/{table['id']}")
    ).status_code == HTTP_NOT_FOUND


async def test_a_table_holding_records_refuses_to_be_deleted(
    app_context: AppContext,
) -> None:
    table = await create_table(app_context.client)
    await _seed_record(app_context.session, table["id"])

    response = await app_context.client.delete(f"{TABLES}/{table['id']}")

    assert response.status_code == HTTP_CONFLICT
    assert code_of(response) == TABLE_NOT_EMPTY
    assert _detail_messages(response) == ["共 1 行历史数据会被一并删除"]


async def test_force_deletes_the_table_together_with_its_records(
    app_context: AppContext,
) -> None:
    # ⚠ 超表上没有外键可以级联，不显式清行就是一批孤儿行
    table = await create_table(app_context.client)
    await _seed_record(app_context.session, table["id"])

    response = await app_context.client.delete(
        f"{TABLES}/{table['id']}", params={"force": "true"}
    )

    assert response.status_code == HTTP_NO_CONTENT
    assert await _record_count(app_context.session, table["id"]) == 0


def _detail_messages(response: httpx.Response) -> list[str]:
    """取错误体里的字段级说明文案。"""
    details: list[dict[str, Any]] = response.json()["details"]
    return [item["message"] for item in details]


async def _record_count(session: AsyncSession, table_id: str) -> int:
    """数一数这张台账名下还剩几行。"""
    return await record_crud.count_by_table(session, uuid.UUID(table_id))
