"""闸 2：每条台账面端点自己判权限码，绕过边缘直连端口时它照样生效。

守的是五档不许互相顶替：能看 / 能改结构 / 能录一行 / 能改自动值 / 能重算全表。
划分依据是**爆炸半径**而不是「读 / 写」（docs/DATASET_DESIGN.md §9）。
"""

import httpx
import pytest
from conftest import SignHeaders

from integration.dataset_helpers import (
    TABLES,
    columns_url,
    create_column,
    create_record,
    create_table,
    overrides_url,
    records_url,
    table_body,
)
from platform_server.apps.dataset.catalog import (
    DATASET_BACKFILL,
    DATASET_MANAGE,
    DATASET_OVERRIDE,
    DATASET_RECORD_WRITE,
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


NODE_KEY = "0192f0c0-0000-7000-8000-00000000abcd:outlet_temp"
MOMENT = "2026-08-23T10:00:00.000Z"


async def test_reading_records_needs_only_the_view_code(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    # ⚠ 记录写的闸 1 规则用的是 `records*` 前缀，`*` 跨斜杠：读面不单独压回来
    # 的话，只读用户连一行数据都翻不出来
    table = await create_table(app_client)

    response = await app_client.get(
        records_url(str(table["id"])), headers=sign([DATASET_VIEW])
    )

    assert response.status_code == 200


async def test_the_table_manage_code_alone_cannot_enter_a_row(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    # ⚠ 改表结构与改一行数据是两档：合成一个码就等于把「能配表」的人一并
    # 授权成「能改账」
    table = await create_table(app_client)
    await create_column(app_client, table["id"], key="产量")

    response = await app_client.post(
        records_url(str(table["id"])),
        json={"ts": MOMENT, "values": {"产量": 1}},
        headers=sign([DATASET_MANAGE]),
    )

    assert response.status_code == HTTP_FORBIDDEN


async def test_the_record_write_code_alone_cannot_correct_a_point_value(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    # ⚠ 修正值优先于自动采集值，等同于篡改台账：能录一行数据的人不该顺手
    # 就能改掉现场采回来的数
    table = await create_table(app_client)
    await create_column(
        app_client, table["id"], key="温度", source="point", node_key=NODE_KEY
    )
    created = await create_record(app_client, str(table["id"]), ts=MOMENT)

    response = await app_client.put(
        overrides_url(str(table["id"]), created["record"]["row_id"], MOMENT),
        json={"values": {"温度": 25}},
        headers=sign([DATASET_RECORD_WRITE]),
    )

    assert response.status_code == HTTP_FORBIDDEN


async def test_the_override_code_alone_cannot_recompute_the_whole_table(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    # ⚠ 重算一次改写大批历史行并吃满数据库，与改一格不是同一类风险
    table = await create_table(app_client)

    response = await app_client.post(
        f"{TABLES}/{table['id']}:recompute",
        json={},
        headers=sign([DATASET_OVERRIDE]),
    )

    assert response.status_code == HTTP_FORBIDDEN


async def test_the_backfill_code_alone_cannot_delete_a_row(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    table = await create_table(app_client)
    await create_column(app_client, table["id"], key="产量")
    created = await create_record(
        app_client, str(table["id"]), ts=MOMENT, values={"产量": 1}
    )

    response = await app_client.delete(
        f"{records_url(str(table['id']))}/{created['record']['row_id']}"
        f"?ts={MOMENT}",
        headers=sign([DATASET_BACKFILL]),
    )

    assert response.status_code == HTTP_FORBIDDEN
