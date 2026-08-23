"""保存一个公式列时的整表试编译：依赖落库、环被拒、坏列不连坐。

⚠ 保存一列**必定编译整张表**——环是整表的性质，只编这一列看不出来。
⚠ 反过来，编译不过的**别的**列不许让整表编译失败：一次 `force` 删列会让引用
它的那几列同时坏掉，若整表随之编不过，用户连挨个修都做不到
（docs/DATASET_DESIGN.md §5.8）。
"""

from typing import Any

import httpx
import pytest

from integration.dataset_helpers import (
    HTTP_BAD_REQUEST,
    HTTP_CONFLICT,
    HTTP_CREATED,
    HTTP_NO_CONTENT,
    code_of,
    column_body,
    columns_url,
    create_column,
    create_table,
    data_of,
)

pytestmark = pytest.mark.requires_postgres

COLUMN_IN_USE = 41206
COLUMN_INVALID = 41211
FORMULA_INVALID = 41212


async def a_table_with_inputs(client: httpx.AsyncClient) -> dict[str, Any]:
    """建一张带进水、出水两列录入的台账。"""
    table = await create_table(client)
    await create_column(client, table["id"], key="进水", name="进水量")
    await create_column(client, table["id"], key="出水", name="出水量")
    return table


async def add_formula(
    client: httpx.AsyncClient, table_id: str, key: str, formula: str
) -> httpx.Response:
    """尝试加一个公式列，回原始响应。"""
    return await client.post(
        columns_url(table_id),
        json=column_body(key=key, name=key, source="formula", formula=formula),
    )


async def test_saving_a_formula_column_stores_what_it_depends_on(
    app_client: httpx.AsyncClient,
) -> None:
    table = await a_table_with_inputs(app_client)

    response = await add_formula(
        app_client, table["id"], "净水", "{进水} - {出水}"
    )

    assert response.status_code == HTTP_CREATED
    assert data_of(response)["formula_deps"]["same_row"] == ["出水", "进水"]


async def test_the_stored_dependencies_carry_every_reference_kind(
    app_client: httpx.AsyncClient,
) -> None:
    table = await a_table_with_inputs(app_client)

    response = await add_formula(
        app_client,
        table["id"],
        "增量",
        "{进水} - PREV({进水}) + SUM_OVER({出水}, '1h') + SUM_ALL({出水})",
    )

    deps = data_of(response)["formula_deps"]
    assert deps["prev"] == [{"key": "进水", "steps": 1}]
    assert deps["window"] == [
        {"func": "SUM_OVER", "key": "出水", "window": "1h"}
    ]
    assert deps["whole"] == [{"func": "SUM_ALL", "key": "出水"}]
    # ⚠ 反查用的扁平索引要把三类都收进来
    assert deps["referenced_keys"] == ["出水", "进水"]


async def test_an_input_column_carries_no_dependencies(
    app_client: httpx.AsyncClient,
) -> None:
    table = await create_table(app_client)

    column = await create_column(app_client, table["id"], key="录入")

    assert column["formula_deps"] is None


async def test_a_formula_column_without_a_formula_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    # 不拦的话这一列永远算不出数，而它看起来只是一列空数据
    table = await create_table(app_client)

    response = await app_client.post(
        columns_url(table["id"]),
        json=column_body(key="净水", name="净水", source="formula"),
    )

    assert response.status_code == HTTP_BAD_REQUEST
    assert code_of(response) == COLUMN_INVALID


async def test_turning_an_input_column_into_a_formula_column_needs_a_formula(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 只看入参会漏掉这一路：改了 source 没给 formula，入参层看不出问题
    table = await create_table(app_client)
    column = await create_column(app_client, table["id"], key="录入")

    response = await app_client.patch(
        f"{columns_url(table['id'])}/{column['id']}",
        json={"source": "formula"},
    )

    assert response.status_code == HTTP_BAD_REQUEST
    assert code_of(response) == COLUMN_INVALID


async def test_a_formula_referencing_a_column_that_does_not_exist_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    table = await a_table_with_inputs(app_client)

    response = await add_formula(app_client, table["id"], "净水", "{没这列}")

    assert response.status_code == HTTP_BAD_REQUEST
    assert code_of(response) == FORMULA_INVALID
    assert "引用了不存在的列" in response.json()["message"]


async def test_a_syntax_error_is_refused_on_save(
    app_client: httpx.AsyncClient,
) -> None:
    table = await a_table_with_inputs(app_client)

    response = await add_formula(app_client, table["id"], "净水", "{进水} +")

    assert response.status_code == HTTP_BAD_REQUEST
    assert code_of(response) == FORMULA_INVALID


async def test_a_column_referencing_itself_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    table = await a_table_with_inputs(app_client)

    response = await add_formula(app_client, table["id"], "自环", "{自环} + 1")

    assert response.status_code == HTTP_BAD_REQUEST
    assert "循环引用" in response.json()["message"]


async def test_closing_a_ring_across_two_columns_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    table = await a_table_with_inputs(app_client)
    await add_formula(app_client, table["id"], "甲", "{进水} + 1")
    first = data_of(await app_client.get(columns_url(table["id"])))
    await add_formula(app_client, table["id"], "乙", "{甲} + 1")

    response = await app_client.patch(
        f"{columns_url(table['id'])}/"
        f"{next(item['id'] for item in first if item['key'] == '甲')}",
        json={"formula": "{乙} + 1"},
    )

    assert response.status_code == HTTP_BAD_REQUEST
    assert "循环引用" in response.json()["message"]


async def test_a_ring_drawn_through_time_windows_is_refused_too(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 窗口含当前行，故 X=SUM_OVER({Y}) 与 Y=SUM_OVER({X}) 是货真价实的环
    table = await a_table_with_inputs(app_client)
    await add_formula(app_client, table["id"], "甲", "{进水} + 1")
    columns = data_of(await app_client.get(columns_url(table["id"])))
    await add_formula(app_client, table["id"], "乙", "SUM_OVER({甲}, '1h')")

    response = await app_client.patch(
        f"{columns_url(table['id'])}/"
        f"{next(item['id'] for item in columns if item['key'] == '甲')}",
        json={"formula": "SUM_OVER({乙}, '1h')"},
    )

    assert response.status_code == HTTP_BAD_REQUEST
    assert "循环引用" in response.json()["message"]


async def test_a_window_over_its_own_column_is_allowed(
    app_client: httpx.AsyncClient,
) -> None:
    # 当前行还没算出这一列的值，故它不贡献进自己的窗口——不构成环
    table = await a_table_with_inputs(app_client)

    response = await add_formula(
        app_client, table["id"], "累计", "SUM_OVER({累计}, '1y') + {进水}"
    )

    assert response.status_code == HTTP_CREATED


async def test_a_column_read_only_through_prev_still_blocks_its_deletion(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 只看同行引用会放行一次让那一列从此算不出数的删除
    table = await a_table_with_inputs(app_client)
    await add_formula(app_client, table["id"], "增量", "PREV({进水})")
    columns = data_of(await app_client.get(columns_url(table["id"])))
    target = next(item for item in columns if item["key"] == "进水")

    response = await app_client.delete(
        f"{columns_url(table['id'])}/{target['id']}"
    )

    assert response.status_code == HTTP_CONFLICT
    assert code_of(response) == COLUMN_IN_USE


async def test_a_forced_delete_leaves_the_rest_of_the_table_editable(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 坏列不连坐：整表随之编不过的话，用户连挨个修都做不到
    table = await a_table_with_inputs(app_client)
    await add_formula(app_client, table["id"], "净水", "{进水} - {出水}")
    columns = data_of(await app_client.get(columns_url(table["id"])))
    doomed = next(item for item in columns if item["key"] == "出水")
    await app_client.delete(
        f"{columns_url(table['id'])}/{doomed['id']}", params={"force": "true"}
    )

    response = await app_client.post(
        columns_url(table["id"]),
        json=column_body(key="另一列", name="另一列"),
    )

    assert response.status_code == HTTP_CREATED


async def test_the_broken_column_can_be_repaired_one_at_a_time(
    app_client: httpx.AsyncClient,
) -> None:
    table = await a_table_with_inputs(app_client)
    await add_formula(app_client, table["id"], "净水", "{进水} - {出水}")
    columns = data_of(await app_client.get(columns_url(table["id"])))
    doomed = next(item for item in columns if item["key"] == "出水")
    broken = next(item for item in columns if item["key"] == "净水")
    await app_client.delete(
        f"{columns_url(table['id'])}/{doomed['id']}", params={"force": "true"}
    )

    response = await app_client.patch(
        f"{columns_url(table['id'])}/{broken['id']}",
        json={"formula": "{进水} * 2"},
    )

    assert response.status_code == 200
    assert data_of(response)["formula_deps"]["same_row"] == ["进水"]


async def test_a_column_that_stops_being_a_formula_drops_its_dependencies(
    app_client: httpx.AsyncClient,
) -> None:
    table = await a_table_with_inputs(app_client)
    created = data_of(
        await add_formula(app_client, table["id"], "净水", "{进水} - {出水}")
    )

    response = await app_client.patch(
        f"{columns_url(table['id'])}/{created['id']}",
        json={"source": "manual"},
    )

    assert data_of(response)["formula_deps"] is None


async def test_a_free_formula_column_is_deleted_without_force(
    app_client: httpx.AsyncClient,
) -> None:
    table = await a_table_with_inputs(app_client)
    created = data_of(
        await add_formula(app_client, table["id"], "净水", "{进水} - {出水}")
    )

    response = await app_client.delete(
        f"{columns_url(table['id'])}/{created['id']}"
    )

    assert response.status_code == HTTP_NO_CONTENT
