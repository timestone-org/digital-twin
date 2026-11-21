"""库公式修改、恢复与实际调用者的兼容性。"""

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from integration.dataset_helpers import (
    TABLES,
    create_column,
    create_record,
    create_table,
    data_of,
)
from integration.test_dataset_formulas_api import (
    a_stored_preset,
    a_table_using,
    create_formula,
    formula_url,
)

pytestmark = pytest.mark.requires_postgres


async def test_additional_required_argument_preserves_the_saved_column(
    app_client: httpx.AsyncClient,
) -> None:
    fx = await create_formula(app_client)
    table = await a_table_using(app_client, "@净值({进水}, {出水})")
    reply = await app_client.patch(
        formula_url(fx["id"]),
        json={
            "expression": "{被减数} - {减数} + {加数}",
            "params": [{"name": name} for name in ("被减数", "减数", "加数")],
        },
    )

    assert reply.status_code == 409
    assert reply.json()["code"] == 41222
    assert "净水量" in reply.json()["message"]
    row = await create_record(
        app_client, table["id"], values={"进水": 12, "出水": 5}
    )
    assert row["record"]["computed"] == {"净水": 7}


async def test_change_validates_nested_library_call_without_any_table(
    app_client: httpx.AsyncClient,
) -> None:
    fx = await create_formula(app_client)
    await create_formula(
        app_client,
        code="二倍差",
        name="二倍差",
        expression="@净值({甲}, {乙}) * 2",
        params=[{"name": "甲"}, {"name": "乙"}],
    )
    reply = await app_client.patch(
        formula_url(fx["id"]),
        json={"expression": "{一项}", "params": [{"name": "一项"}]},
    )
    assert reply.status_code == 409
    assert "二倍差" in reply.json()["message"]
    assert (
        data_of(await app_client.get(formula_url(fx["id"])))["expression"]
        == fx["expression"]
    )


async def test_edit_updates_cross_table_dependencies_for_every_caller(
    app_client: httpx.AsyncClient,
) -> None:
    first = await create_table(app_client, code="old_ref")
    second = await create_table(app_client, code="new_ref")
    for ref in (first, second):
        await create_column(app_client, ref["id"], key="v", name="产量")
    fx = await create_formula(
        app_client,
        expression="{x} + {old_ref.v}",
        params=[{"name": "x"}],
    )
    consumer = await a_table_using(app_client, "@净值({进水})")
    reply = await app_client.patch(
        formula_url(fx["id"]), json={"expression": "{x} + MAX_ALL({new_ref.v})"}
    )
    assert reply.status_code == 200
    owner = data_of(await app_client.get(f"{TABLES}/{consumer['id']}"))
    computed_column = next(c for c in owner["columns"] if c["key"] == "净水")
    assert computed_column["formula_deps"]["whole"] == [
        {"func": "MAX_ALL", "key": "new_ref.v"}
    ]
    assert computed_column["formula_deps"]["external"] == []
    assert (
        await app_client.delete(f"{TABLES}/{second['id']}")
    ).status_code == 409
    assert (
        await app_client.delete(f"{TABLES}/{first['id']}")
    ).status_code == 204


async def test_new_missing_table_reference_preserves_the_previous_definition(
    app_client: httpx.AsyncClient,
) -> None:
    fx = await create_formula(app_client)
    await a_table_using(app_client, "@净值({进水}, {出水})")
    reply = await app_client.patch(
        formula_url(fx["id"]),
        json={"expression": "{被减数}-{减数}+{no_such_table.v}"},
    )
    assert reply.status_code == 409
    assert "no_such_table" in reply.json()["message"]
    assert (
        data_of(await app_client.get(formula_url(fx["id"])))["expression"]
        == fx["expression"]
    )


async def test_restoring_a_preset_checks_callers_of_its_custom_signature(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
) -> None:
    preset = await a_stored_preset(db_session)
    url = formula_url(str(preset.id))
    edited = await app_client.patch(
        url,
        json={
            "expression": "{a} + {b}",
            "params": [{"name": "a"}, {"name": "b"}],
            "is_enabled": True,
        },
    )
    assert edited.status_code == 200
    await a_table_using(app_client, f"@{preset.code}({{进水}}, {{出水}})")
    response = await app_client.post(url + ":restore")
    assert response.status_code == 409
    assert "净水量" in response.json()["message"]
    assert data_of(await app_client.get(url))["expression"] == "{a} + {b}"


async def test_rejects_a_new_same_row_cycle_but_allows_the_prior_row_dependency(
    app_client: httpx.AsyncClient,
) -> None:
    fx = await create_formula(
        app_client,
        code="previous",
        expression="PREV({值}, 1)",
        params=[{"name": "值"}],
    )
    table = await create_table(app_client)
    await create_column(
        app_client,
        table["id"],
        key="roll",
        name="累计",
        source="formula",
        formula="@previous({roll})",
    )
    reply = await app_client.patch(
        formula_url(fx["id"]), json={"expression": "{值} * 2"}
    )

    assert reply.status_code == 409
    issue = reply.json()["details"][0]
    assert issue["field"] == "columns[shift_output.roll]"
    assert "循环" in issue["message"]


async def test_incompatible_change_can_be_replaced_with_a_valid_edit(
    app_client: httpx.AsyncClient,
) -> None:
    fx = await create_formula(app_client)
    table = await a_table_using(app_client, "@净值({进水},{出水})")
    old_row = await create_record(
        app_client, table["id"], values={"进水": 10, "出水": 3}
    )
    reply = await app_client.patch(
        formula_url(fx["id"]), json={"expression": "({被减数}-{减数})*3"}
    )
    assert reply.status_code == 200
    new_row = await create_record(
        app_client, table["id"], values={"进水": 10, "出水": 3}
    )
    assert new_row["record"]["computed"]["净水"] == 21
    result = await app_client.get(f"{TABLES}/{table['id']}/records")
    assert result.status_code == 200
    previous = next(
        item
        for item in data_of(result)["items"]
        if item["row_id"] == old_row["record"]["row_id"]
    )
    assert previous["computed"]["净水"] == 7


async def test_disabling_a_formula_used_by_another_definition_is_a_conflict(
    app_client: httpx.AsyncClient,
) -> None:
    fx = await create_formula(app_client)
    await create_formula(
        app_client,
        code="wrapper",
        expression="@净值({进},{出})",
        params=[{"name": "进"}, {"name": "出"}],
    )
    reply = await app_client.patch(
        formula_url(fx["id"]), json={"is_enabled": False}
    )
    assert reply.status_code == 409
    assert "wrapper" in reply.json()["message"]


@pytest.mark.parametrize(
    "formula",
    [
        "{readings.missing}",
        "SUM_OVER({readings.missing}, '1d')",
        "MAX_ALL({readings.missing})",
    ],
)
async def test_new_foreign_column_must_exist_in_the_referenced_definition(
    app_client: httpx.AsyncClient, formula: str
) -> None:
    source = await create_table(app_client, code="readings")
    await create_column(app_client, source["id"], key="v", name="存在的列")
    fx = await create_formula(app_client)
    await a_table_using(app_client, "@净值({进水}, {出水})")
    reply = await app_client.patch(
        formula_url(fx["id"]), json={"expression": "{被减数}-{减数}+" + formula}
    )
    assert reply.status_code == 409
    assert "readings.missing" in reply.json()["details"][0]["message"]
    assert (
        data_of(await app_client.get(formula_url(fx["id"])))["expression"]
        == fx["expression"]
    )


async def test_a_compatible_edit_preserves_an_existing_historical_key(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_table(app_client, code="readings")
    old = await create_column(
        app_client, source["id"], key="legacy", name="历史读数"
    )
    fx = await create_formula(
        app_client, expression="{x}+{readings.legacy}", params=[{"name": "x"}]
    )
    await a_table_using(app_client, "@净值({进水})")
    removed = await app_client.delete(
        f"{TABLES}/{source['id']}/columns/{old['id']}", params={"force": True}
    )
    assert removed.status_code == 204
    reply = await app_client.patch(
        formula_url(fx["id"]), json={"expression": "{x}*2+{readings.legacy}"}
    )
    assert reply.status_code == 200
