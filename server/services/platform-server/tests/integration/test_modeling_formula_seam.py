"""整条链路：台账取数 → 训练 → 发布 → 绑定 → **台账列真出数**。

这是本模块存在的理由那一条。⚠ 造的数据是严格线性的
`能耗 = 2×温度 + 3×负荷 + 5`，于是最后那一格算出来的数是可以手算核对的——
「公式列不再报错」不等于「算的是那个模型」。
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
        client, code, _no_scaling(f"energy_{code}")
    )
    run = await _run_pipeline(client, sessions, pipeline["id"])
    assert run["status"] == "succeeded", run
    return await _publish(client, run["id"], f"{code} 模型")


def _no_scaling(table_code: str) -> dict[str, Any]:
    """去掉标准化那一步，让系数留在原始尺度上便于手算核对。

    Args: table_code。
    """
    graph = linear_graph(table_code)
    graph["nodes"] = [item for item in graph["nodes"] if item["id"] != "z"]
    graph["edges"] = [
        item for item in graph["edges"] if item["id"] not in {"e2", "e3"}
    ]
    graph["edges"].append(
        {
            "id": "relink",
            "from_node": "f",
            "from_port": "frame",
            "to_node": "p",
            "to_port": "frame",
        }
    )
    return graph


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
