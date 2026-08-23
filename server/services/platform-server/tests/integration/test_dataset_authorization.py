"""闸 2：每条台账面端点自己判权限码，绕过边缘直连端口时它照样生效。

守的是「能看」与「能改结构」两档不许互相顶替。
"""

import httpx
import pytest
from conftest import SignHeaders

from integration.dataset_helpers import (
    TABLES,
    columns_url,
    create_column,
    create_table,
    table_body,
)
from platform_server.apps.dataset.catalog import (
    DATASET_MANAGE,
    DATASET_VIEW,
)

pytestmark = pytest.mark.requires_postgres

HTTP_FORBIDDEN = 403


async def test_reading_tables_needs_the_view_code(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    response = await app_client.get(TABLES, headers=sign([DATASET_MANAGE]))

    assert response.status_code == HTTP_FORBIDDEN


async def test_the_view_code_alone_cannot_create_a_table(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    response = await app_client.post(
        TABLES, json=table_body(), headers=sign([DATASET_VIEW])
    )

    assert response.status_code == HTTP_FORBIDDEN


async def test_the_view_code_alone_cannot_delete_a_table(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    table = await create_table(app_client)

    response = await app_client.delete(
        f"{TABLES}/{table['id']}", headers=sign([DATASET_VIEW])
    )

    assert response.status_code == HTTP_FORBIDDEN


async def test_the_view_code_alone_cannot_reorder_columns(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    # ⚠ 重排是动作端点，是 POST 却真的改数据，不该随「读面动作」放行
    table = await create_table(app_client)
    column = await create_column(app_client, table["id"])

    response = await app_client.post(
        f"{columns_url(table['id'])}:reorder",
        json={"column_ids": [column["id"]]},
        headers=sign([DATASET_VIEW]),
    )

    assert response.status_code == HTTP_FORBIDDEN


async def test_reading_columns_needs_the_view_code(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    table = await create_table(app_client)

    response = await app_client.get(
        columns_url(table["id"]), headers=sign([DATASET_MANAGE])
    )

    assert response.status_code == HTTP_FORBIDDEN
