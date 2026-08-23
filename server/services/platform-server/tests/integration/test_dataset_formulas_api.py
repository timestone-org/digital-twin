"""公式库面：增删改查、引用反查，以及两道守着不可逆动作的闸。

⚠ 全篇最贵的一条：**停用一条还在被引用的库公式，破坏力与删除相同**。引用它的
列在**解析期**就失败，而保存任一列都会试编译整张表，于是那张表的录入、导入、
人工修正与重算一起 400。故停用与删除都是 409，都要把受影响的台账**与后果**
说出来，且都没有 `force` 出口（docs/DATASET_DESIGN.md §5.11）。
"""

from typing import Any

import httpx
import pytest
from conftest import SignHeaders
from sqlalchemy.ext.asyncio import AsyncSession

from integration.dataset_helpers import (
    HTTP_BAD_REQUEST,
    HTTP_CONFLICT,
    HTTP_CREATED,
    HTTP_NO_CONTENT,
    HTTP_NOT_FOUND,
    HTTP_OK,
    create_column,
    create_table,
    data_of,
)
from platform_server.apps.dataset.builtin_formulas import BUILTIN_FORMULAS
from platform_server.apps.dataset.catalog import FORMULA_MANAGE, FORMULA_VIEW
from platform_server.apps.dataset.crud import formula_crud
from platform_server.apps.dataset.models import DatasetFormula
from platform_server.apps.dataset.services.formula_library import (
    params_to_json,
    seed_builtin_formulas,
)

pytestmark = pytest.mark.requires_postgres

FORMULAS = "/api/v1/platform/formulas"
HTTP_FORBIDDEN = 403


def formula_url(formula_id: str) -> str:
    """一条库公式的地址。"""
    return f"{FORMULAS}/{formula_id}"


def formula_body(**overrides: Any) -> dict[str, Any]:
    """一条最小可用的库公式。"""
    body: dict[str, Any] = {
        "code": "净值",
        "name": "两列之差",
        "expression": "{被减数} - {减数}",
        "params": [{"name": "被减数"}, {"name": "减数"}],
    }
    body.update(overrides)
    return body


async def create_formula(
    client: httpx.AsyncClient, **overrides: Any
) -> dict[str, Any]:
    """建一条库公式并回它的出参。"""
    response = await client.post(FORMULAS, json=formula_body(**overrides))
    assert response.status_code == HTTP_CREATED, response.text
    return data_of(response)


async def a_table_using(
    client: httpx.AsyncClient, formula: str, **table: Any
) -> dict[str, Any]:
    """建一张台账，带两列录入与一列用了库公式的公式列。"""
    created = await create_table(client, **table)
    await create_column(client, created["id"], key="进水", name="进水量")
    await create_column(client, created["id"], key="出水", name="出水量")
    await create_column(
        client,
        created["id"],
        key="净水",
        name="净水量",
        source="formula",
        formula=formula,
    )
    return created


async def a_stored_preset(session: AsyncSession) -> DatasetFormula:
    """库里有一条被改歪、且被停用的出厂预设。

    ⚠ 先查再建：种子跑过的库里这条已经在了，直接插会撞唯一约束。
    """
    preset = BUILTIN_FORMULAS[0]
    row = await formula_crud.get_by_code(session, preset.code)
    if row is None:
        row = DatasetFormula(
            code=preset.code,
            category="custom",
            params_json=[],
            description=None,
            is_builtin=True,
        )
        session.add(row)
    row.name = "被改过的名字"
    row.expression = "1 + 1"
    row.params_json = []
    row.is_builtin = True
    row.is_enabled = False
    await session.flush()
    return row


async def test_a_new_formula_comes_back_with_its_signature(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.post(FORMULAS, json=formula_body())

    assert response.status_code == HTTP_CREATED, response.text
    created = data_of(response)
    assert created["signature"] == "@净值(被减数, 减数)"
    assert created["is_builtin"] is False
    assert created["is_enabled"] is True
    assert response.headers["Location"].endswith(created["id"])


async def test_the_same_code_cannot_be_taken_twice(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 标识就是调用点上的那个字面量，撞了就是两条公式共用身份
    await create_formula(app_client)

    response = await app_client.post(FORMULAS, json=formula_body())

    assert response.status_code == HTTP_CONFLICT


async def test_a_body_that_hard_codes_a_ledger_column_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.post(
        FORMULAS,
        json=formula_body(expression="{产量} * 2", params=[]),
    )

    assert response.status_code == HTTP_BAD_REQUEST
    assert "未声明的形参" in response.json()["message"]


async def test_a_window_parameter_without_a_default_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 报错要指回「默认值」那一栏，不是指回样例调用
    response = await app_client.post(
        FORMULAS,
        json=formula_body(
            code="窗口均值",
            expression="AVG_OVER({值}, {窗口})",
            params=[
                {"name": "值"},
                {"name": "窗口", "kind": "value", "label": "时间窗"},
            ],
        ),
    )

    assert response.status_code == HTTP_BAD_REQUEST
    assert "还没有默认值" in response.json()["message"]


async def test_the_list_and_the_detail_agree(
    app_client: httpx.AsyncClient,
) -> None:
    created = await create_formula(app_client)

    listed = data_of(await app_client.get(FORMULAS, params={"q": "净值"}))
    detail = data_of(await app_client.get(formula_url(created["id"])))

    assert [item["id"] for item in listed] == [created["id"]]
    assert detail["expression"] == "{被减数} - {减数}"


async def test_an_unknown_formula_is_a_not_found(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(
        formula_url("3fa85f64-5717-4562-b3fc-2c963f66afa6")
    )

    assert response.status_code == HTTP_NOT_FOUND


async def test_a_column_can_actually_call_the_library_formula(
    app_client: httpx.AsyncClient,
) -> None:
    await create_formula(app_client)

    table = await a_table_using(app_client, "@净值({进水}, {出水})")
    detail = data_of(
        await app_client.get(f"/api/v1/platform/dataset-tables/{table['id']}")
    )

    net = next(item for item in detail["columns"] if item["key"] == "净水")
    # 展开之后依赖就是原生的：库公式在这一层已经不存在了
    assert net["formula_deps"]["same_row"] == ["出水", "进水"]


async def test_the_insert_panel_lists_the_library(
    app_client: httpx.AsyncClient,
) -> None:
    created = await create_formula(app_client)
    table = await create_table(app_client)

    catalog = data_of(
        await app_client.get(
            f"/api/v1/platform/dataset-tables/{table['id']}/formula-functions"
        )
    )

    assert created["code"] in catalog["library"]


async def test_a_disabled_formula_is_gone_from_the_insert_panel(
    app_client: httpx.AsyncClient,
) -> None:
    created = await create_formula(app_client)
    await app_client.patch(
        formula_url(created["id"]), json={"is_enabled": False}
    )
    table = await create_table(app_client)

    catalog = data_of(
        await app_client.get(
            f"/api/v1/platform/dataset-tables/{table['id']}/formula-functions"
        )
    )

    assert created["code"] not in catalog["library"]


async def test_a_disabled_formula_says_disabled_when_a_column_uses_it(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 说成「库里没有 X」会把人送去建一条已经存在的公式
    created = await create_formula(app_client)
    await app_client.patch(
        formula_url(created["id"]), json={"is_enabled": False}
    )
    table = await create_table(app_client)
    await create_column(app_client, table["id"], key="进水", name="进水量")
    await create_column(app_client, table["id"], key="出水", name="出水量")

    response = await app_client.post(
        f"/api/v1/platform/dataset-tables/{table['id']}/columns",
        json={
            "key": "净水",
            "name": "净水量",
            "source": "formula",
            "formula": "@净值({进水}, {出水})",
        },
    )

    assert response.status_code == HTTP_BAD_REQUEST
    assert "已停用" in response.json()["message"]


async def test_disabling_a_referenced_formula_names_the_table_and_the_damage(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 这条 409 是整个模块里最重要的一道闸：停用等同于删除
    created = await create_formula(app_client)
    await a_table_using(app_client, "@净值({进水}, {出水})", name="班次台账")

    response = await app_client.patch(
        formula_url(created["id"]), json={"is_enabled": False}
    )

    assert response.status_code == HTTP_CONFLICT
    message = response.json()["message"]
    assert "班次台账" in message
    assert "数据录入" in message


async def test_disabling_an_unused_formula_is_fine(
    app_client: httpx.AsyncClient,
) -> None:
    created = await create_formula(app_client)

    response = await app_client.patch(
        formula_url(created["id"]), json={"is_enabled": False}
    )

    assert response.status_code == HTTP_OK
    assert data_of(response)["is_enabled"] is False


async def test_renaming_a_used_formula_does_not_talk_about_recomputing(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 改名不改口径，历史行没有任何东西过期——提示重算是一句假话
    created = await create_formula(app_client)
    await a_table_using(app_client, "@净值({进水}, {出水})")

    response = await app_client.patch(
        formula_url(created["id"]), json={"name": "净水量差"}
    )

    assert response.status_code == HTTP_OK
    assert "重算" not in response.json()["message"]


async def test_changing_the_body_of_a_used_formula_asks_for_a_recompute(
    app_client: httpx.AsyncClient,
) -> None:
    created = await create_formula(app_client)
    await a_table_using(app_client, "@净值({进水}, {出水})")

    response = await app_client.patch(
        formula_url(created["id"]),
        json={"expression": "({被减数} - {减数}) * 2"},
    )

    assert response.status_code == HTTP_OK
    assert "重算" in response.json()["message"]
    assert len(data_of(response)["usages"]) == 1


async def test_the_usages_endpoint_names_the_column_that_calls_it(
    app_client: httpx.AsyncClient,
) -> None:
    created = await create_formula(app_client)
    table = await a_table_using(app_client, "@净值({进水}, {出水})")

    usages = data_of(
        await app_client.get(f"{formula_url(created['id'])}/usages")
    )

    assert [item["column_key"] for item in usages] == ["净水"]
    assert usages[0]["table_id"] == table["id"]
    assert usages[0]["is_direct"] is True


async def test_an_indirect_reference_still_counts_as_a_usage(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 判据是解析之后的 `used_fx`，不是文本搜索：只有这样才看得见嵌套引用
    inner = await create_formula(app_client)
    await create_formula(
        app_client,
        code="翻倍净值",
        name="两列之差的两倍",
        expression="@净值({甲}, {乙}) * 2",
        params=[{"name": "甲"}, {"name": "乙"}],
    )
    await a_table_using(app_client, "@翻倍净值({进水}, {出水})")

    usages = data_of(await app_client.get(f"{formula_url(inner['id'])}/usages"))

    assert [item["column_key"] for item in usages] == ["净水"]
    assert usages[0]["is_direct"] is False


async def test_deleting_an_unused_formula_works(
    app_client: httpx.AsyncClient,
) -> None:
    created = await create_formula(app_client)

    response = await app_client.delete(formula_url(created["id"]))

    assert response.status_code == HTTP_NO_CONTENT
    detail = await app_client.get(formula_url(created["id"]))
    assert detail.status_code == HTTP_NOT_FOUND


async def test_deleting_a_formula_a_column_uses_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    created = await create_formula(app_client)
    await a_table_using(app_client, "@净值({进水}, {出水})", name="班次台账")

    response = await app_client.delete(formula_url(created["id"]))

    assert response.status_code == HTTP_CONFLICT
    assert "班次台账" in response.json()["message"]


async def test_deleting_a_formula_only_another_formula_calls_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 两侧都要查：没有台账列用它，但库里另一条公式在调它
    inner = await create_formula(app_client)
    await create_formula(
        app_client,
        code="翻倍净值",
        name="两列之差的两倍",
        expression="@净值({甲}, {乙}) * 2",
        params=[{"name": "甲"}, {"name": "乙"}],
    )

    response = await app_client.delete(formula_url(inner["id"]))

    assert response.status_code == HTTP_CONFLICT
    assert "翻倍净值" in response.json()["message"]


async def test_a_disabled_formula_can_still_not_be_deleted_while_used(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    # ⚠ 反查快照一律按启用算：照原样解析的话，引用方会因为「已停用」报错而被
    # 当成「没人用」，于是这条不可逆的删除被放行
    created = await create_formula(app_client)
    await a_table_using(app_client, "@净值({进水}, {出水})")
    row = await db_session.get(DatasetFormula, created["id"])
    assert row is not None
    row.is_enabled = False
    await db_session.flush()

    response = await app_client.delete(formula_url(created["id"]))

    assert response.status_code == HTTP_CONFLICT


async def test_a_preset_cannot_be_deleted(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    row = await a_stored_preset(db_session)

    response = await app_client.delete(formula_url(str(row.id)))

    assert response.status_code == HTTP_BAD_REQUEST
    assert "停用" in response.json()["message"]


async def test_restoring_a_preset_brings_back_the_factory_semantics(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    preset = BUILTIN_FORMULAS[0]
    row = await a_stored_preset(db_session)

    restored = data_of(
        await app_client.post(f"{formula_url(str(row.id))}:restore")
    )

    assert restored["expression"] == preset.expression
    assert restored["name"] == preset.name
    assert restored["params"] == params_to_json(preset.params)


async def test_restoring_a_preset_leaves_the_switch_alone(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    # ⚠ 恢复的是口径，不是开关：顺手翻回启用等于悄悄打开一个运维刻意关掉的东西
    row = await a_stored_preset(db_session)

    restored = data_of(
        await app_client.post(f"{formula_url(str(row.id))}:restore")
    )

    assert restored["is_enabled"] is False


async def test_restoring_a_hand_made_formula_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    created = await create_formula(app_client)

    response = await app_client.post(f"{formula_url(created['id'])}:restore")

    assert response.status_code == HTTP_BAD_REQUEST
    assert "出厂口径" in response.json()["message"]


async def test_reading_the_library_needs_the_view_code(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    response = await app_client.get(FORMULAS, headers=sign([FORMULA_MANAGE]))

    assert response.status_code == HTTP_FORBIDDEN


async def test_the_dataset_manage_code_alone_cannot_write_the_library(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    # ⚠ 两个码分家的全部意义：改一条库公式会同时改掉所有引用它的台账列
    response = await app_client.post(
        FORMULAS, json=formula_body(), headers=sign([FORMULA_VIEW])
    )

    assert response.status_code == HTTP_FORBIDDEN


async def test_seeding_fills_the_gaps_and_is_repeatable(
    db_session: AsyncSession,
) -> None:
    await seed_builtin_formulas(db_session)

    again = await seed_builtin_formulas(db_session)

    stored = {row.code for row in await formula_crud.list_all(db_session)}
    assert again == 0
    assert stored >= {entry.code for entry in BUILTIN_FORMULAS}


async def test_seeding_never_overwrites_a_preset_someone_edited(
    db_session: AsyncSession,
) -> None:
    # ⚠ 只补缺：改过的预设不会在下次启动时被改回去，回到出厂口径是「恢复预设」
    # 那个显式动作。停用开关同理——运维关掉的那条不会被翻回来
    row = await a_stored_preset(db_session)
    # ⚠ 缺几条要就地数，不能写死：写死就等于假设别的用例已经把种子跑过了，
    # 而用例顺序是随机的——那样这条会按跑法时绿时红
    stored = await formula_crud.list_all(db_session)
    present = {entry.code for entry in stored}
    missing = {entry.code for entry in BUILTIN_FORMULAS} - present

    added = await seed_builtin_formulas(db_session)

    assert added == len(missing)
    assert row.code in present
    assert (row.expression, row.is_enabled) == ("1 + 1", False)
