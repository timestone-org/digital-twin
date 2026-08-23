"""台账面用例共用的 URL、请求体与建资源的捷径。"""

from typing import Any

import httpx

TABLES = "/api/v1/platform/dataset-tables"
# 台账报脏的跨进程契约键，见 docs/DATASET_DESIGN.md §16
DIRTY_KEY = "platform:dataset:dirty"

HTTP_OK = 200
HTTP_CREATED = 201
HTTP_NO_CONTENT = 204
HTTP_BAD_REQUEST = 400
HTTP_NOT_FOUND = 404
HTTP_CONFLICT = 409


def data_of(response: httpx.Response) -> Any:
    """取信封里的 data。"""
    return response.json()["data"]


def code_of(response: httpx.Response) -> int:
    """取信封里的错误码。"""
    return int(response.json()["code"])


def columns_url(table_id: str) -> str:
    """一张台账的列集合地址。"""
    return f"{TABLES}/{table_id}/columns"


def records_url(table_id: str) -> str:
    """一张台账的数据行集合地址。"""
    return f"{TABLES}/{table_id}/records"


def record_url(table_id: str, row_id: str, ts: str | None = None) -> str:
    """一行的地址。带上 `ts` 直接命中分区。"""
    tail = "" if ts is None else f"?ts={ts}"
    return f"{records_url(table_id)}/{row_id}{tail}"


def overrides_url(table_id: str, row_id: str, ts: str | None = None) -> str:
    """一行的人工修正地址。"""
    tail = "" if ts is None else f"?ts={ts}"
    return f"{records_url(table_id)}/{row_id}/overrides{tail}"


def table_body(**overrides: Any) -> dict[str, Any]:
    """一张最小可用的台账。"""
    body: dict[str, Any] = {"code": "shift_output", "name": "班次产量"}
    body.update(overrides)
    return body


def column_body(**overrides: Any) -> dict[str, Any]:
    """一列最小可用的人工录入列。"""
    body: dict[str, Any] = {"key": "产量", "name": "产量"}
    body.update(overrides)
    return body


async def create_table(
    client: httpx.AsyncClient, **overrides: Any
) -> dict[str, Any]:
    """建一张台账并回它的出参。"""
    response = await client.post(TABLES, json=table_body(**overrides))
    assert response.status_code == HTTP_CREATED, response.text
    return data_of(response)


async def create_column(
    client: httpx.AsyncClient, table_id: str, **overrides: Any
) -> dict[str, Any]:
    """给一张台账加一列并回它的出参。"""
    response = await client.post(
        columns_url(table_id), json=column_body(**overrides)
    )
    assert response.status_code == HTTP_CREATED, response.text
    return data_of(response)


async def create_record(
    client: httpx.AsyncClient, table_id: str, **body: Any
) -> dict[str, Any]:
    """录入一行并回它的出参（含 `has_stale_downstream`）。"""
    response = await client.post(records_url(table_id), json=body)
    assert response.status_code == HTTP_CREATED, response.text
    return data_of(response)
