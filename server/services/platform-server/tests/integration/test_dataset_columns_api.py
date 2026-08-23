"""列的建改删读与整体重排：key 是身份且不可改，删列要先面对引用它的公式。

⚠ 这条链上有三处「不报错但错」：key 里混进公式记号（`{key}` 引用切不回这一列）、
点位汇总列不绑点位（列永远是空的）、以及重排时把名单外的列一并挪走
（并发编辑时另一个人刚加的列会消失在列表顶端）。
"""

from typing import Any

import httpx
import pytest
from conftest import AppContext

from integration.dataset_helpers import (
    HTTP_BAD_REQUEST,
    HTTP_CONFLICT,
    HTTP_CREATED,
    HTTP_NO_CONTENT,
    HTTP_NOT_FOUND,
    TABLES,
    code_of,
    column_body,
    columns_url,
    create_column,
    create_table,
    data_of,
)
from lib.utils.ids import uuid7

pytestmark = pytest.mark.requires_postgres

COLUMN_KEY_TAKEN = 41204
COLUMN_IN_USE = 41206
COLUMN_INVALID = 41211
NODE_KEY = "0192f0c0-0000-7000-8000-00000000abcd:outlet_temp"


async def test_a_new_column_is_created_with_a_location_header(
    app_client: httpx.AsyncClient,
) -> None:
    table = await create_table(app_client)

    response = await app_client.post(
        columns_url(table["id"]), json=column_body()
    )

    assert response.status_code == HTTP_CREATED
    created = data_of(response)
    assert response.headers["Location"] == (
        f"{TABLES}/{table['id']}/columns/{created['id']}"
    )


async def test_a_new_column_defaults_to_a_manual_number_column(
    app_client: httpx.AsyncClient,
) -> None:
    table = await create_table(app_client)

    created = await create_column(app_client, table["id"])

    assert created["source"] == "manual"
    assert created["data_type"] == "number"
    assert created["agg"] == "avg"
    # 公式引擎随第 2 期落地，在那之前依赖恒为空
    assert created["formula_deps"] is None


async def test_columns_without_an_order_are_appended(
    app_client: httpx.AsyncClient,
) -> None:
    table = await create_table(app_client)

    first = await create_column(app_client, table["id"], key="甲")
    second = await create_column(app_client, table["id"], key="乙")

    assert [first["order_index"], second["order_index"]] == [0, 1]


async def test_an_explicit_order_index_is_honoured(
    app_client: httpx.AsyncClient,
) -> None:
    table = await create_table(app_client)

    created = await create_column(app_client, table["id"], order_index=7)

    assert created["order_index"] == 7


async def test_updating_a_column_leaves_the_untouched_fields_alone(
    app_client: httpx.AsyncClient,
) -> None:
    table = await create_table(app_client)
    column = await create_column(app_client, table["id"])

    response = await app_client.patch(
        f"{columns_url(table['id'])}/{column['id']}",
        json={"name": "改过的名字", "unit": "吨"},
    )

    updated = data_of(response)
    assert (updated["name"], updated["unit"]) == ("改过的名字", "吨")
    assert updated["key"] == column["key"]
    assert updated["source"] == column["source"]


async def test_an_explicit_null_clears_the_unit(
    app_client: httpx.AsyncClient,
) -> None:
    table = await create_table(app_client)
    column = await create_column(app_client, table["id"], unit="吨")

    response = await app_client.patch(
        f"{columns_url(table['id'])}/{column['id']}", json={"unit": None}
    )

    assert data_of(response)["unit"] is None


async def test_a_duplicate_key_in_the_same_table_is_a_conflict(
    app_client: httpx.AsyncClient,
) -> None:
    table = await create_table(app_client)
    await create_column(app_client, table["id"])

    response = await app_client.post(
        columns_url(table["id"]), json=column_body()
    )

    assert response.status_code == HTTP_CONFLICT
    assert code_of(response) == COLUMN_KEY_TAKEN


async def test_the_same_key_is_free_again_in_another_table(
    app_client: httpx.AsyncClient,
) -> None:
    first = await create_table(app_client, code="one")
    second = await create_table(app_client, code="two")
    await create_column(app_client, first["id"])

    created = await create_column(app_client, second["id"])

    assert created["key"] == "产量"


@pytest.mark.parametrize(
    "key",
    ["有 空格", "带.点", "带:冒号", "带(括号)", "带{花括号}", "带[方括号]"],
)
async def test_a_key_carrying_a_formula_token_is_rejected(
    app_client: httpx.AsyncClient, key: str
) -> None:
    # ⚠ 这些都是公式语法里的记号，混进 key 就切不回这一列；花括号尤其
    # 不能漏——引用写作 `{key}`，混进一个就永远引用不到这一列
    table = await create_table(app_client)

    response = await app_client.post(
        columns_url(table["id"]), json=column_body(key=key)
    )

    assert response.status_code == HTTP_BAD_REQUEST


async def test_a_chinese_key_is_accepted(
    app_client: httpx.AsyncClient,
) -> None:
    table = await create_table(app_client)

    created = await create_column(app_client, table["id"], key="进水量")

    assert created["key"] == "进水量"


async def test_a_point_column_must_bind_a_point(
    app_client: httpx.AsyncClient,
) -> None:
    table = await create_table(app_client)

    response = await app_client.post(
        columns_url(table["id"]), json=column_body(source="point")
    )

    assert response.status_code == HTTP_BAD_REQUEST
    assert code_of(response) == COLUMN_INVALID


async def test_a_malformed_node_key_is_rejected(
    app_client: httpx.AsyncClient,
) -> None:
    table = await create_table(app_client)

    response = await app_client.post(
        columns_url(table["id"]),
        json=column_body(source="point", node_key="没有冒号"),
    )

    assert response.status_code == HTTP_BAD_REQUEST
    assert code_of(response) == COLUMN_INVALID


async def test_a_point_column_keeps_its_aggregation(
    app_client: httpx.AsyncClient,
) -> None:
    table = await create_table(app_client)

    created = await create_column(
        app_client,
        table["id"],
        source="point",
        node_key=NODE_KEY,
        agg="delta",
    )

    assert created["agg"] == "delta"
    assert created["node_key"] == NODE_KEY


async def test_switching_a_column_to_point_without_a_key_is_rejected(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 只看入参会漏掉这一路：入参层看不出「改了 source 却没给 node_key」
    table = await create_table(app_client)
    column = await create_column(app_client, table["id"])

    response = await app_client.patch(
        f"{columns_url(table['id'])}/{column['id']}",
        json={"source": "point"},
    )

    assert response.status_code == HTTP_BAD_REQUEST
    assert code_of(response) == COLUMN_INVALID


async def test_the_key_cannot_be_changed_through_the_update_payload(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ key 是 JSONB 里的字段名，改一次等于让这一列的历史值集体失联
    table = await create_table(app_client)
    column = await create_column(app_client, table["id"])

    response = await app_client.patch(
        f"{columns_url(table['id'])}/{column['id']}", json={"key": "别的"}
    )

    assert response.status_code == HTTP_BAD_REQUEST


async def test_a_column_of_another_table_is_not_found(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 报 404 而不是 403：403 等于告诉调用方「这个 id 存在」
    first = await create_table(app_client, code="one")
    second = await create_table(app_client, code="two")
    column = await create_column(app_client, first["id"])

    response = await app_client.patch(
        f"{columns_url(second['id'])}/{column['id']}", json={"name": "改名"}
    )

    assert response.status_code == HTTP_NOT_FOUND


async def test_reordering_applies_the_given_order(
    app_client: httpx.AsyncClient,
) -> None:
    table = await create_table(app_client)
    first = await create_column(app_client, table["id"], key="甲")
    second = await create_column(app_client, table["id"], key="乙")

    response = await app_client.post(
        f"{columns_url(table['id'])}:reorder",
        json={"column_ids": [second["id"], first["id"]]},
    )

    assert [item["key"] for item in data_of(response)] == ["乙", "甲"]


async def test_reordering_ignores_ids_outside_the_table(
    app_client: httpx.AsyncClient,
) -> None:
    table = await create_table(app_client)
    column = await create_column(app_client, table["id"])

    response = await app_client.post(
        f"{columns_url(table['id'])}:reorder",
        json={"column_ids": [str(uuid7()), column["id"]]},
    )

    assert [item["id"] for item in data_of(response)] == [column["id"]]


async def test_a_column_left_out_of_the_reorder_keeps_its_place(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 名单外的列静默保持原样：并发编辑时另一个人刚加的列不该跳到最前
    table = await create_table(app_client)
    first = await create_column(app_client, table["id"], key="甲")
    second = await create_column(app_client, table["id"], key="乙")

    await app_client.post(
        f"{columns_url(table['id'])}:reorder",
        json={"column_ids": [first["id"]]},
    )

    listed = data_of(await app_client.get(columns_url(table["id"])))
    assert [item["key"] for item in listed] == ["甲", "乙"]
    assert second["order_index"] == 1


async def test_a_free_column_is_deleted_without_force(
    app_client: httpx.AsyncClient,
) -> None:
    table = await create_table(app_client)
    column = await create_column(app_client, table["id"])

    response = await app_client.delete(
        f"{columns_url(table['id'])}/{column['id']}"
    )

    assert response.status_code == HTTP_NO_CONTENT
    assert data_of(await app_client.get(columns_url(table["id"]))) == []


async def test_a_referenced_column_refuses_to_be_deleted(
    app_context: AppContext,
) -> None:
    table, referenced = await _table_with_a_dependent(app_context)

    response = await app_context.client.delete(
        f"{columns_url(table['id'])}/{referenced['id']}"
    )

    assert response.status_code == HTTP_CONFLICT
    assert code_of(response) == COLUMN_IN_USE
    # 列的是**引用者**：用户要改的是那几列的公式，不是被删的这一列
    assert _detail_fields(response) == ["columns[合计]"]


async def test_force_deletes_a_referenced_column(
    app_context: AppContext,
) -> None:
    table, referenced = await _table_with_a_dependent(app_context)

    response = await app_context.client.delete(
        f"{columns_url(table['id'])}/{referenced['id']}",
        params={"force": "true"},
    )

    assert response.status_code == HTTP_NO_CONTENT


async def _table_with_a_dependent(
    context: AppContext,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """建一张台账：一列被另一列的公式引用着。依赖由保存时的试编译解析出来。"""
    table = await create_table(context.client)
    referenced = await create_column(context.client, table["id"])
    await create_column(
        context.client,
        table["id"],
        key="合计",
        source="formula",
        formula="{产量} * 2",
    )
    return table, referenced


def _detail_fields(response: httpx.Response) -> list[str]:
    """取错误体里的字段级说明指向了谁。"""
    details: list[dict[str, Any]] = response.json()["details"]
    return [item["field"] for item in details]
