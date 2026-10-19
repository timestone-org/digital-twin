"""公式编辑器试算必须加载已绑定模型，并保留停用原因。"""

import uuid
from typing import Any
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from unit.database_fakes import MakerSessions

from integration.dataset_helpers import TABLES, create_column
from integration.modeling_helpers import (
    HTTP_CREATED,
    HTTP_OK,
    PIPELINES,
    RUNS,
    create_pipeline,
    data_of,
    drive_run,
    linear_graph,
)
from integration.test_modeling_api import _seed_ledger
from integration.test_modeling_formula_seam import (
    BINDINGS,
    EXPECTED,
    LOAD,
    SAMPLE_LOAD,
    SAMPLE_TEMPERATURE,
    TEMPERATURE,
    VERSIONS,
    _publish,
    _trained_version,
)
from lib.testing import FakeObjectStore
from platform_server.apps.dataset.services import (
    AnalysisModel,
    register_provider,
)
from platform_server.apps.modeling.services.model_provider import (
    ModelingAnalysisProvider,
)

pytestmark = pytest.mark.requires_postgres


async def preview_table(
    client: httpx.AsyncClient,
    session: AsyncSession,
    sessions: MakerSessions,
) -> tuple[str, dict[str, Any]]:
    version = await _trained_version(client, session, sessions, "preview")
    return await register_preview_table(client, version)


async def register_preview_table(
    client: httpx.AsyncClient, version: dict[str, Any]
) -> tuple[str, dict[str, Any]]:
    registered = await client.post(
        f"{VERSIONS}/{version['id']}:register-formula",
        json={"fx_code": "试算能耗"},
    )
    assert registered.status_code == HTTP_CREATED, registered.text
    response = await client.post(
        TABLES, json={"code": "preview_plan", "name": "计划试算"}
    )
    assert response.status_code == HTTP_CREATED, response.text
    table_id = str(data_of(response)["id"])
    for key in (TEMPERATURE, LOAD):
        await create_column(client, table_id, key=key, name=key)
    return table_id, dict(data_of(registered)["binding"])


async def binary_version(
    client: httpx.AsyncClient,
    session: AsyncSession,
    sessions: MakerSessions,
    store: FakeObjectStore,
) -> dict[str, Any]:
    code = "binary_preview"
    await _seed_ledger(client, session, code)
    graph = linear_graph(code)
    for node in graph["nodes"]:
        if node["id"] == "m":
            node["operator"] = "tree_regressor"
            node["config"] = {"n_estimators": 2, "max_depth": 2}
    pipeline = await create_pipeline(client, code, graph)
    response = await client.post(
        f"{PIPELINES}/{pipeline['id']}:run", json={"trigger": "manual"}
    )
    assert response.status_code == 202, response.text
    run_id = str(data_of(response)["id"])
    await drive_run(sessions, uuid.UUID(run_id), store)
    run = data_of(await client.get(f"{RUNS}/{run_id}"))
    assert run["status"] == "succeeded", run
    version = await _publish(client, run_id, "二进制预览边界")
    assert version["serving_channel"] == "binary"
    assert version["is_servable"] is True, version["unservable_reason"]
    return version


@pytest.mark.parametrize(
    "formula",
    [
        "@试算能耗({温度}, {负荷})",
        "PREDICT('试算能耗', {温度}, {负荷})",
    ],
)
async def test_preview_uses_the_same_published_model_as_record_calculation(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
    formula: str,
) -> None:
    table_id, _ = await preview_table(app_client, db_session, worker_sessions)
    response = await app_client.post(
        f"{TABLES}/{table_id}/formula:preview",
        json={
            "formula": formula,
            "values": {TEMPERATURE: SAMPLE_TEMPERATURE, LOAD: SAMPLE_LOAD},
        },
    )
    assert response.status_code == HTTP_OK, response.text
    result = data_of(response)
    assert result["is_ok"] is True, result["error"]
    assert result["value"] == pytest.approx(EXPECTED)
    assert result["history_refs"] == []


async def test_preview_reports_a_disabled_binding_without_predicting(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    table_id, binding = await preview_table(
        app_client, db_session, worker_sessions
    )
    response = await app_client.patch(
        f"{BINDINGS}/{binding['id']}", json={"is_enabled": False}
    )
    assert response.status_code == HTTP_OK, response.text
    response = await app_client.post(
        f"{TABLES}/{table_id}/formula:preview",
        json={"formula": "PREDICT('试算能耗', 25, 430)", "values": {}},
    )
    result = data_of(response)
    assert result["is_ok"] is False
    assert result["value"] is None
    assert "已停用" in result["error"]


async def test_binary_preview_is_refused_before_reading_model_artifacts(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
    object_store: FakeObjectStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    version = await binary_version(
        app_client, db_session, worker_sessions, object_store
    )
    table_id, _ = await register_preview_table(app_client, version)
    read = AsyncMock(wraps=object_store.get_bytes)
    monkeypatch.setattr(object_store, "get_bytes", read)
    provider = ModelingAnalysisProvider(store=object_store)
    register_provider(provider)
    response = await app_client.post(
        f"{TABLES}/{table_id}/formula:preview",
        json={"formula": "PREDICT('试算能耗', 25, 430)", "values": {}},
    )
    assert response.status_code == HTTP_OK, response.text
    result = data_of(response)
    assert result["is_ok"] is False
    assert result["value"] is None
    assert "二进制模型" in result["error"]
    assert "公式预览暂不支持" in result["error"]
    read.assert_not_awaited()
    models = await provider.load(worker_sessions, frozenset({"试算能耗"}))
    model = models["试算能耗"]
    assert isinstance(model, AnalysisModel)
    assert model.predict([25.0, 430.0]) is not None
    read.assert_awaited_once()
