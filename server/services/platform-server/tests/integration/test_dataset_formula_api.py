"""公式面的三条端点：函数目录、校验、试算。

⚠ 校验与试算用 **200 + `is_ok=false`** 报公式错误。编辑器里「公式还没写完」是
正常状态，用 HTTP 错误回答会让前端把它当成故障（docs/DATASET_DESIGN.md §6.1）。
"""

from typing import Any

import httpx
import pytest
from conftest import SignHeaders

from integration.dataset_helpers import (
    TABLES,
    create_column,
    create_table,
    data_of,
)
from platform_server.apps.dataset.catalog import DATASET_MANAGE, DATASET_VIEW

pytestmark = pytest.mark.requires_postgres

HTTP_OK = 200
HTTP_FORBIDDEN = 403
HTTP_NOT_FOUND = 404
HTTP_INVALID = 400
MAX_FORMULA_LENGTH = 2_000


def functions_url(table_id: str) -> str:
    """函数目录的地址。"""
    return f"{TABLES}/{table_id}/formula-functions"


def validate_url(table_id: str) -> str:
    """校验端点的地址。"""
    return f"{TABLES}/{table_id}/formula:validate"


def preview_url(table_id: str) -> str:
    """试算端点的地址。"""
    return f"{TABLES}/{table_id}/formula:preview"


async def a_table_with_two_input_columns(
    client: httpx.AsyncClient,
) -> dict[str, Any]:
    """建一张台账，带进水与出水两列人工录入。"""
    table = await create_table(client)
    await create_column(client, table["id"], key="进水", name="进水量")
    await create_column(client, table["id"], key="出水", name="出水量")
    return table


async def validate(
    client: httpx.AsyncClient, table_id: str, **body: Any
) -> dict[str, Any]:
    """调一次校验端点并回它的 data。"""
    response = await client.post(validate_url(table_id), json=body)
    assert response.status_code == HTTP_OK, response.text
    return data_of(response)


async def preview(
    client: httpx.AsyncClient, table_id: str, **body: Any
) -> dict[str, Any]:
    """调一次试算端点并回它的 data。"""
    response = await client.post(preview_url(table_id), json=body)
    assert response.status_code == HTTP_OK, response.text
    return data_of(response)


async def test_the_catalog_lists_functions_columns_and_tables(
    app_client: httpx.AsyncClient,
) -> None:
    table = await a_table_with_two_input_columns(app_client)
    other = await create_table(app_client, code="other", name="另一张")

    catalog = data_of(await app_client.get(functions_url(table["id"])))

    assert {item["name"] for item in catalog["functions"]} >= {"SUM_ALL", "LN"}
    assert [item["key"] for item in catalog["columns"]] == ["进水", "出水"]
    assert [item["code"] for item in catalog["tables"]] == [other["code"]]
    # 库公式的插入面板由 `P/formulas` 那一族喂，这里只列出启用中的标识；
    # 空库是正常状态，不是错误（docs/DATASET_DESIGN.md §5.11）
    assert isinstance(catalog["library"], list)


async def test_the_catalog_never_hand_writes_a_function_arity(
    app_client: httpx.AsyncClient,
) -> None:
    table = await create_table(app_client)

    catalog = data_of(await app_client.get(functions_url(table["id"])))

    by_name = {item["name"]: item for item in catalog["functions"]}
    assert (by_name["ROUND"]["min_args"], by_name["ROUND"]["max_args"]) == (
        1,
        2,
    )
    # 不限参数个数时给 null
    assert by_name["SUM"]["max_args"] is None


async def test_the_catalog_ships_the_categories_and_the_rules(
    app_client: httpx.AsyncClient,
) -> None:
    table = await create_table(app_client)

    catalog = data_of(await app_client.get(functions_url(table["id"])))

    assert {item["value"] for item in catalog["categories"]} >= {"math"}
    assert any("ISBLANK" in rule for rule in catalog["rules"])
    assert {item["value"] for item in catalog["window_units"]} >= {"15m"}
    assert {item["value"] for item in catalog["operators"]} >= {"%"}


async def test_the_catalog_of_an_unknown_table_is_a_not_found(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(
        functions_url("3fa85f64-5717-4562-b3fc-2c963f66afa6")
    )

    assert response.status_code == HTTP_NOT_FOUND


async def test_a_good_formula_comes_back_with_its_dependencies_and_reading(
    app_client: httpx.AsyncClient,
) -> None:
    table = await a_table_with_two_input_columns(app_client)

    result = await validate(
        app_client, table["id"], formula="{进水} - {出水}", column_key="净水"
    )

    assert result["is_ok"] is True
    assert result["error"] is None
    assert result["deps"]["same_row"] == ["出水", "进水"]
    assert result["deps"]["referenced_keys"] == ["出水", "进水"]
    assert result["notation_text"] == "进水量 − 出水量"
    assert result["notation"]["t"] == "bin"


async def test_a_syntax_error_is_reported_inside_a_successful_response(
    app_client: httpx.AsyncClient,
) -> None:
    table = await a_table_with_two_input_columns(app_client)

    result = await validate(app_client, table["id"], formula="{进水} +")

    assert result["is_ok"] is False
    assert "语法错误" in result["error"]
    assert result["notation"] is None


async def test_an_unknown_column_is_reported_the_same_way(
    app_client: httpx.AsyncClient,
) -> None:
    table = await a_table_with_two_input_columns(app_client)

    result = await validate(app_client, table["id"], formula="{没这列} + 1")

    assert result["is_ok"] is False
    assert "引用了不存在的列" in result["error"]


async def test_an_unknown_table_code_is_reported_the_same_way(
    app_client: httpx.AsyncClient,
) -> None:
    table = await a_table_with_two_input_columns(app_client)

    result = await validate(app_client, table["id"], formula="{nope.x} + 1")

    assert result["is_ok"] is False
    assert "引用了不存在的台账：nope" in result["error"]


async def test_the_column_being_edited_may_reference_itself_by_key(
    app_client: httpx.AsyncClient,
) -> None:
    # 新建那一列时它还不在库里，但它的 key 已经定下来了
    table = await a_table_with_two_input_columns(app_client)

    result = await validate(
        app_client,
        table["id"],
        formula="SUM_OVER({累计}, '1y')",
        column_key="累计",
    )

    assert result["is_ok"] is True


async def test_a_column_referencing_itself_in_the_same_row_is_a_cycle(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 自环不豁免，交互式校验也一样
    table = await a_table_with_two_input_columns(app_client)

    result = await validate(
        app_client, table["id"], formula="{净水} + 1", column_key="净水"
    )

    assert result["is_ok"] is False
    assert "循环引用：净水" in result["error"]


async def test_a_cycle_against_a_saved_column_is_reported(
    app_client: httpx.AsyncClient,
) -> None:
    table = await a_table_with_two_input_columns(app_client)
    await create_column(
        app_client,
        table["id"],
        key="乙",
        name="乙",
        source="formula",
        formula="{进水} + 1",
    )
    await create_column(
        app_client,
        table["id"],
        key="甲",
        name="甲",
        source="formula",
        formula="{乙} + 1",
    )

    result = await validate(
        app_client, table["id"], formula="{甲} + 1", column_key="乙"
    )

    assert result["is_ok"] is False
    assert "循环引用" in result["error"]


async def test_a_window_cycle_is_caught_by_the_interactive_check_too(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 交互式校验与保存时的整表试编译必须**同一套连边规则**，否则编辑器说
    # 「没问题」而保存报错，用户没法判断信哪一个
    table = await a_table_with_two_input_columns(app_client)
    await create_column(
        app_client,
        table["id"],
        key="乙",
        name="乙",
        source="formula",
        formula="{进水} + 1",
    )
    await create_column(
        app_client,
        table["id"],
        key="甲",
        name="甲",
        source="formula",
        formula="SUM_OVER({乙}, '1h')",
    )

    result = await validate(
        app_client,
        table["id"],
        formula="SUM_OVER({甲}, '1h')",
        column_key="乙",
    )

    assert result["is_ok"] is False
    assert "循环引用" in result["error"]


async def test_without_a_column_key_no_cycle_check_runs(
    app_client: httpx.AsyncClient,
) -> None:
    # 不知道这条公式将来落在哪一列，就无从判断成不成环
    table = await a_table_with_two_input_columns(app_client)

    result = await validate(app_client, table["id"], formula="{进水} + 1")

    assert result["is_ok"] is True


async def test_an_oversized_formula_is_rejected_at_the_boundary(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 长度上限是对 AST 递归栈的防守，不是省流量
    table = await create_table(app_client)

    response = await app_client.post(
        validate_url(table["id"]),
        json={"formula": "1+" * MAX_FORMULA_LENGTH + "1"},
    )

    assert response.status_code == HTTP_INVALID


async def test_a_trial_run_bounds_how_many_sample_values_it_accepts(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 有上限不是省流量：这是个无界字典入参
    table = await create_table(app_client)

    response = await app_client.post(
        preview_url(table["id"]),
        json={
            "formula": "1",
            "values": {str(index): index for index in range(500)},
        },
    )

    assert response.status_code == HTTP_INVALID


async def test_a_trial_run_computes_from_the_values_it_is_given(
    app_client: httpx.AsyncClient,
) -> None:
    table = await a_table_with_two_input_columns(app_client)

    result = await preview(
        app_client,
        table["id"],
        formula="{进水} - {出水}",
        values={"进水": 10, "出水": 4},
    )

    assert result["is_ok"] is True
    assert result["value"] == 6
    assert result["missing"] == []


async def test_a_trial_run_names_the_column_that_made_the_answer_blank(
    app_client: httpx.AsyncClient,
) -> None:
    table = await a_table_with_two_input_columns(app_client)

    result = await preview(
        app_client,
        table["id"],
        formula="{进水} - {出水}",
        values={"进水": 10},
    )

    assert result["value"] is None
    assert result["missing"] == ["出水"]
    # ⚠ 减法上刻意不提议改用 SUM：那里的空才是正确答案
    assert result["should_suggest_sum"] is False


async def test_a_pure_addition_offers_the_skip_missing_alternative(
    app_client: httpx.AsyncClient,
) -> None:
    table = await a_table_with_two_input_columns(app_client)

    result = await preview(
        app_client,
        table["id"],
        formula="{进水} + {出水}",
        values={"进水": 10},
    )

    assert result["value"] is None
    assert result["should_suggest_sum"] is True


async def test_a_trial_run_says_which_history_it_could_not_read(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 本期不取历史，一律按空处理——不说出来就等于让人以为那些引用真的算了
    table = await a_table_with_two_input_columns(app_client)

    result = await preview(
        app_client,
        table["id"],
        formula="PREV({进水}) + SUM_OVER({进水}, '1h') + SUM_ALL({进水})",
        values={"进水": 10},
    )

    assert result["value"] is None
    assert result["history_refs"] == [
        "PREV({进水})",
        "SUM_ALL({进水})",
        "SUM_OVER({进水}, '1h')",
    ]


async def test_a_trial_run_reports_a_type_mismatch_without_failing_the_call(
    app_client: httpx.AsyncClient,
) -> None:
    table = await a_table_with_two_input_columns(app_client)

    result = await preview(
        app_client,
        table["id"],
        formula="{进水} - 1",
        values={"进水": "停机"},
    )

    assert result["is_ok"] is False
    assert "非数字值" in result["error"]


async def test_reading_the_catalog_needs_the_view_code(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    table = await create_table(app_client)

    response = await app_client.get(
        functions_url(table["id"]), headers=sign([DATASET_MANAGE])
    )

    assert response.status_code == HTTP_FORBIDDEN


@pytest.mark.parametrize("action", ["formula:validate", "formula:preview"])
async def test_the_view_code_alone_cannot_validate_or_preview(
    app_client: httpx.AsyncClient, sign: SignHeaders, action: str
) -> None:
    # 校验与试算归 manage：它们是配置公式这件事的一部分
    table = await create_table(app_client)

    response = await app_client.post(
        f"{TABLES}/{table['id']}/{action}",
        json={"formula": "1"},
        headers=sign([DATASET_VIEW]),
    )

    assert response.status_code == HTTP_FORBIDDEN
