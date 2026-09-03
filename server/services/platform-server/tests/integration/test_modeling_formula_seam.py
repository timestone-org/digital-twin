"""整条链路：台账取数 → 训练 → 发布 → 绑定 → **台账列真出数**。

这是本模块存在的理由那一条。⚠ 造的数据是严格线性的
`能耗 = 2×温度 + 3×负荷 + 5`，于是最后那一格算出来的数是可以手算核对的——
「公式列不再报错」不等于「算的是那个模型」。

⚠ 图里**必须留着标准化那一步**：带拟合的算子把参数丢掉这一类缺陷只有它才暴露
得出来（标准化在单行上重算会当场除零），摘掉它这条链路就什么都验不到
（docs/MODELING_PLATFORM_DESIGN.md 缺陷 A）。数据是严格线性的、标准化是可逆的，
故预测值仍然等于手算的那个数。
"""

from typing import Any

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from unit.database_fakes import MakerSessions

from integration.dataset_helpers import (
    TABLES,
    columns_url,
    create_column,
    records_url,
)
from integration.modeling_helpers import (
    ENERGY,
    HTTP_CONFLICT,
    HTTP_CREATED,
    HTTP_OK,
    LOAD,
    TEMPERATURE,
    code_of,
    create_pipeline,
    data_of,
    linear_graph,
)
from integration.test_modeling_api import _run_pipeline, _seed_ledger

pytestmark = pytest.mark.requires_postgres

VERSIONS = "/api/v1/platform/modeling-model-versions"
BINDINGS = "/api/v1/platform/modeling-bindings"
FORMULAS = "/api/v1/platform/formulas"

BINDING_PARAMS_MISMATCH = 41416
MODEL_VERSION_IN_USE = 41413
BINDING_ENTRY_CHANGED = 41424

# 一次预测的两个实参与手算出来的答案
SAMPLE_TEMPERATURE = 25.0
SAMPLE_LOAD = 430.0
EXPECTED = 2.0 * SAMPLE_TEMPERATURE + 3.0 * SAMPLE_LOAD + 5.0


async def _publish(
    client: httpx.AsyncClient, run_id: str, name: str
) -> dict[str, Any]:
    """把一次成功运行发布成版本。

    Args: client, run_id, name。
    """
    response = await client.post(
        VERSIONS, json={"run_id": run_id, "name": name}
    )
    assert response.status_code == HTTP_CREATED, response.text
    return dict(data_of(response))


async def _library_entry(
    client: httpx.AsyncClient, code: str, params: list[str]
) -> None:
    """在公式库里建一条调模型的条目。

    ⚠ 用户侧看到的就是一条普通库公式：体是 `PREDICT('标识', {形参}…)`，
    调用点照旧写 `@标识(实参…)`。
    Args: client, code, params。
    """
    body = {
        "code": code,
        "name": code,
        "expression": "PREDICT('"
        + code
        + "', "
        + ", ".join(f"{{{name}}}" for name in params)
        + ")",
        "params": [{"name": name, "kind": "column"} for name in params],
    }
    response = await client.post(FORMULAS, json=body)
    assert response.status_code == HTTP_CREATED, response.text


async def _trained_version(
    client: httpx.AsyncClient,
    session: AsyncSession,
    sessions: MakerSessions,
    code: str,
) -> dict[str, Any]:
    """种数据、训一遍、发布，回那个版本。

    Args: client, session, sessions, code。
    """
    await _seed_ledger(client, session, f"energy_{code}")
    pipeline = await create_pipeline(
        client, code, linear_graph(f"energy_{code}")
    )
    run = await _run_pipeline(client, sessions, pipeline["id"])
    assert run["status"] == "succeeded", run
    return await _publish(client, run["id"], f"{code} 模型")


async def test_a_trained_run_publishes_a_servable_version(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """跑通的运行发布出来的版本是可上线的，且带上了输入契约与指标。"""
    version = await _trained_version(
        app_client, db_session, worker_sessions, "pub"
    )
    assert version["is_servable"] is True
    assert version["unservable_reason"] is None
    assert version["feature_keys"] == [TEMPERATURE, LOAD]
    assert version["target_key"] == ENERGY
    assert version["metrics"]["r2"] == pytest.approx(1.0)
    assert version["fingerprint"]["sklearn"]


async def test_the_ledger_column_produces_the_model_value(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """**整条链路的验收**：台账列写 `@能耗预测(...)`，录一行，那一格出数。"""
    version = await _trained_version(
        app_client, db_session, worker_sessions, "seam"
    )
    await _library_entry(app_client, "能耗预测", [TEMPERATURE, LOAD])
    response = await app_client.post(
        BINDINGS,
        json={"fx_code": "能耗预测", "model_version_id": version["id"]},
    )
    assert response.status_code == HTTP_CREATED, response.text
    assert [item["feature"] for item in data_of(response)["param_map"]] == [
        TEMPERATURE,
        LOAD,
    ]

    table = data_of(
        await app_client.post(
            TABLES, json={"code": "predict_here", "name": "预测表"}
        )
    )
    for key in (TEMPERATURE, LOAD):
        await create_column(app_client, table["id"], key=key, name=key)
    await app_client.post(
        columns_url(table["id"]),
        json={
            "key": "预测能耗",
            "name": "预测能耗",
            "source": "formula",
            "formula": f"@能耗预测({{{TEMPERATURE}}}, {{{LOAD}}})",
        },
    )
    row = data_of(
        await app_client.post(
            records_url(table["id"]),
            json={
                "values": {
                    TEMPERATURE: SAMPLE_TEMPERATURE,
                    LOAD: SAMPLE_LOAD,
                }
            },
        )
    )["record"]
    assert row["computed"]["预测能耗"] == pytest.approx(EXPECTED, rel=1e-6)
    assert not (row["compute_error"] or {}).get("预测能耗")


async def test_an_unbound_model_leaves_a_readable_reason(
    app_client: httpx.AsyncClient,
) -> None:
    """没绑定时那一格空着，但 `compute_error` 上有一句人话。"""
    await _library_entry(app_client, "还没绑的模型", [TEMPERATURE])
    table = data_of(
        await app_client.post(
            TABLES, json={"code": "unbound_here", "name": "未绑定表"}
        )
    )
    await create_column(app_client, table["id"], key=TEMPERATURE, name="温度")
    await app_client.post(
        columns_url(table["id"]),
        json={
            "key": "预测",
            "name": "预测",
            "source": "formula",
            "formula": f"@还没绑的模型({{{TEMPERATURE}}})",
        },
    )
    row = data_of(
        await app_client.post(
            records_url(table["id"]),
            json={"values": {TEMPERATURE: 1.0}},
        )
    )["record"]
    assert row["computed"]["预测"] is None
    assert "模型未绑定" in row["compute_error"]["预测"]


async def test_binding_rejects_a_param_count_mismatch(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """形参个数与特征数对不上时拒绝绑定，不放行一个必然算错的映射。"""
    version = await _trained_version(
        app_client, db_session, worker_sessions, "mism"
    )
    await _library_entry(app_client, "少一个形参", [TEMPERATURE])
    response = await app_client.post(
        BINDINGS,
        json={"fx_code": "少一个形参", "model_version_id": version["id"]},
    )
    assert response.status_code == HTTP_CONFLICT
    assert code_of(response) == BINDING_PARAMS_MISMATCH


async def test_a_bound_version_cannot_be_retired(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """还有绑定指着的版本退役不了。"""
    version = await _trained_version(
        app_client, db_session, worker_sessions, "keep"
    )
    await _library_entry(app_client, "在用的模型", [TEMPERATURE, LOAD])
    await app_client.post(
        BINDINGS,
        json={"fx_code": "在用的模型", "model_version_id": version["id"]},
    )
    response = await app_client.delete(f"{VERSIONS}/{version['id']}")
    assert response.status_code == HTTP_CONFLICT
    assert code_of(response) == MODEL_VERSION_IN_USE


async def test_rebinding_reports_the_affected_columns(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """换绑的回执带影响面——重算由用户在台账页显式发起，不在这里顺带做。"""
    version = await _trained_version(
        app_client, db_session, worker_sessions, "impact"
    )
    await _library_entry(app_client, "影响面模型", [TEMPERATURE, LOAD])
    binding = data_of(
        await app_client.post(
            BINDINGS,
            json={
                "fx_code": "影响面模型",
                "model_version_id": version["id"],
            },
        )
    )
    table = data_of(
        await app_client.post(
            TABLES, json={"code": "impact_here", "name": "影响面表"}
        )
    )
    for key in (TEMPERATURE, LOAD):
        await create_column(app_client, table["id"], key=key, name=key)
    await app_client.post(
        columns_url(table["id"]),
        json={
            "key": "预测",
            "name": "预测",
            "source": "formula",
            "formula": f"@影响面模型({{{TEMPERATURE}}}, {{{LOAD}}})",
        },
    )
    updated = data_of(
        await app_client.patch(
            f"{BINDINGS}/{binding['id']}", json={"is_enabled": False}
        )
    )
    assert {item["column_key"] for item in updated["usages"]} == {"预测"}


async def test_a_disabled_binding_says_so(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """停用绑定之后那一格空着，原因是「模型绑定已停用」。"""
    version = await _trained_version(
        app_client, db_session, worker_sessions, "off"
    )
    await _library_entry(app_client, "停用的模型", [TEMPERATURE, LOAD])
    binding = data_of(
        await app_client.post(
            BINDINGS,
            json={
                "fx_code": "停用的模型",
                "model_version_id": version["id"],
            },
        )
    )
    await app_client.patch(
        f"{BINDINGS}/{binding['id']}", json={"is_enabled": False}
    )
    table = data_of(
        await app_client.post(
            TABLES, json={"code": "off_here", "name": "停用表"}
        )
    )
    for key in (TEMPERATURE, LOAD):
        await create_column(app_client, table["id"], key=key, name=key)
    await app_client.post(
        columns_url(table["id"]),
        json={
            "key": "预测",
            "name": "预测",
            "source": "formula",
            "formula": f"@停用的模型({{{TEMPERATURE}}}, {{{LOAD}}})",
        },
    )
    row = data_of(
        await app_client.post(
            records_url(table["id"]),
            json={"values": {TEMPERATURE: 1.0, LOAD: 2.0}},
        )
    )["record"]
    assert "已停用" in row["compute_error"]["预测"]


async def test_one_click_registration_builds_both_halves(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """一键注册一步建出条目与绑定，形参名取台账列的显示名。

    ⚠ 这是本期存在的理由那一条：在它之前用户要自己理解「条目 / 形参 /
    按位置映射」三个概念，而这三个没有一个是他想要的。
    """
    version = await _trained_version(
        app_client, db_session, worker_sessions, "oneclick"
    )
    response = await app_client.post(
        f"{VERSIONS}/{version['id']}:register-formula",
        json={"fx_code": "一键能耗"},
    )
    assert response.status_code == HTTP_CREATED, response.text
    registered = data_of(response)
    assert registered["formula"]["code"] == "一键能耗"
    assert [item["name"] for item in registered["formula"]["params"]] == [
        TEMPERATURE,
        LOAD,
    ]
    assert registered["binding"]["fx_code"] == "一键能耗"


async def test_the_registered_formula_really_computes(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """一键注册出来的公式，在台账列上算出的数与手算一致。

    ⚠ 「建出来了」不等于「算得对」：形参顺序错位时两样都建得出来，只是数不对。
    """
    version = await _trained_version(
        app_client, db_session, worker_sessions, "oneclickcalc"
    )
    await app_client.post(
        f"{VERSIONS}/{version['id']}:register-formula",
        json={"fx_code": "一键核对"},
    )
    table = data_of(
        await app_client.post(
            TABLES, json={"code": "oneclick_here", "name": "一键预测表"}
        )
    )
    for key in (TEMPERATURE, LOAD):
        await create_column(app_client, table["id"], key=key, name=key)
    await app_client.post(
        columns_url(table["id"]),
        json={
            "key": "预测能耗",
            "name": "预测能耗",
            "source": "formula",
            "formula": f"@一键核对({{{TEMPERATURE}}}, {{{LOAD}}})",
        },
    )
    row = data_of(
        await app_client.post(
            records_url(table["id"]),
            json={
                "values": {
                    TEMPERATURE: SAMPLE_TEMPERATURE,
                    LOAD: SAMPLE_LOAD,
                }
            },
        )
    )["record"]
    assert row["computed"]["预测能耗"] == pytest.approx(EXPECTED, rel=1e-6)


async def test_an_occupied_code_is_refused_not_overwritten(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """标识被占了就拒掉，绝不静默覆盖别人在用的公式。"""
    version = await _trained_version(
        app_client, db_session, worker_sessions, "oneclicktaken"
    )
    await _library_entry(app_client, "已占用的", [TEMPERATURE, LOAD])
    response = await app_client.post(
        f"{VERSIONS}/{version['id']}:register-formula",
        json={"fx_code": "已占用的"},
    )
    assert response.status_code == HTTP_CONFLICT


async def test_an_occupied_code_keeps_the_other_entry_intact(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """标识被占时，别人那条条目**原样还在**。

    ⚠ 静默覆盖一条别人在用的公式是不可逆的：引用它的每一张台账的数值会跟着
    换一套口径，而没有任何一处会报错。
    """
    version = await _trained_version(
        app_client, db_session, worker_sessions, "oneclickintact"
    )
    await _library_entry(app_client, "别人的", [TEMPERATURE, LOAD])
    before = _entry_named(data_of(await app_client.get(FORMULAS)), "别人的")
    await app_client.post(
        f"{VERSIONS}/{version['id']}:register-formula",
        json={"fx_code": "别人的"},
    )
    after = _entry_named(data_of(await app_client.get(FORMULAS)), "别人的")
    assert after["expression"] == before["expression"]
    assert after["params"] == before["params"]


def _entry_named(listed: list[dict[str, Any]], code: str) -> dict[str, Any]:
    """公式库列表里那一条。

    Args: listed, code。
    """
    for item in listed:
        if item["code"] == code:
            return item
    raise AssertionError(f"公式库里没有「{code}」")


async def test_rebinding_to_the_same_shape_needs_no_confirmation(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """入口契约没变时换版本一步到位。

    ⚠ 重训一版通常什么都没变——那一档不该逼用户点确认，否则确认框会被当成
    「随手点掉」的东西，等到真变了那次也一样被点掉。
    """
    await _seed_ledger(app_client, db_session, "energy_rebindsame")
    pipeline = await create_pipeline(
        app_client, "rebindsame", linear_graph("energy_rebindsame")
    )
    run = await _run_pipeline(app_client, worker_sessions, pipeline["id"])
    first = await _publish(app_client, run["id"], "第一版")
    await _library_entry(app_client, "换版同形", [TEMPERATURE, LOAD])
    binding = data_of(
        await app_client.post(
            BINDINGS,
            json={"fx_code": "换版同形", "model_version_id": first["id"]},
        )
    )
    # ⚠ 一次运行只发布得出一个版本，第二版要再跑一遍
    again = await _run_pipeline(app_client, worker_sessions, pipeline["id"])
    second = await _publish(app_client, again["id"], "第二版")
    response = await app_client.patch(
        f"{BINDINGS}/{binding['id']}",
        json={"model_version_id": second["id"]},
    )
    assert response.status_code == HTTP_OK, response.text
    assert data_of(response)["model_version_id"] == second["id"]
