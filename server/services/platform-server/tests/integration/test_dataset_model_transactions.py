"""二进制公式模型的首次下载与台账写事务分离。"""

from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from conftest import AppContext

from integration.dataset_helpers import (
    TABLES,
    create_column,
    create_record,
    overrides_url,
    records_url,
    run_recompute,
)
from integration.modeling_helpers import HTTP_OK, LOAD, TEMPERATURE, data_of
from integration.test_dataset_overrides_api import NODE_KEY
from integration.test_modeling_artifact_transactions import active_transactions
from integration.test_modeling_formula_preview import (
    binary_version,
    register_preview_table,
)
from platform_server.apps.dataset.services import register_provider
from platform_server.apps.modeling.services.model_provider import (
    ModelingAnalysisProvider,
)

pytestmark = pytest.mark.requires_postgres


async def a_model_table(context: AppContext) -> str:
    """建立一张有二进制模型绑定和一行输入的台账。Args: context。"""
    client = context.client
    version = await binary_version(
        client, context.session, context.sessions, context.object_store
    )
    table_id, _ = await register_preview_table(client, version)
    await create_record(
        client,
        table_id,
        ts="2026-10-01T00:00:00Z",
        values={TEMPERATURE: 25, LOAD: 430},
    )
    await create_column(
        client,
        table_id,
        key="预测",
        source="formula",
        formula="@试算能耗({温度}, {负荷})",
    )
    return table_id


@contextmanager
def observe_download(
    context: AppContext, monkeypatch: pytest.MonkeyPatch
) -> Iterator[list[int]]:
    """观察冷模型下载期间的业务会话。Args: context, monkeypatch。"""
    register_provider(ModelingAnalysisProvider(store=context.object_store))
    original = context.object_store.get_bytes
    reads: list[int] = []
    with active_transactions() as active:

        async def read(key: str) -> bytes:
            reads.append(len(active))
            return await original(key)

        monkeypatch.setattr(context.object_store, "get_bytes", read)
        yield reads


async def test_recompute_fetches_its_model_before_the_write_transaction(
    app_context: AppContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    table_id = await a_model_table(app_context)
    with observe_download(app_context, monkeypatch) as reads:
        _, outcome = await run_recompute(app_context, table_id)
    assert outcome["status"] == "done", outcome
    assert outcome["recomputed"] == 1
    response = await app_context.client.get(records_url(table_id))
    assert response.status_code == HTTP_OK
    record = data_of(response)["items"][0]
    assert isinstance(record["computed"]["预测"], (float, int)), record
    assert reads == [0]


async def test_an_empty_recompute_window_does_not_download_a_model(
    app_context: AppContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    table_id = await a_model_table(app_context)
    with observe_download(app_context, monkeypatch) as reads:
        _, outcome = await run_recompute(
            app_context, table_id, since="2026-10-02T00:00:00Z"
        )
    assert outcome["status"] == "done", outcome
    assert outcome["recomputed"] == 0
    assert reads == []


async def test_row_creation_downloads_the_model_outside_its_transaction(
    app_context: AppContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    table_id = await a_model_table(app_context)
    with observe_download(app_context, monkeypatch) as reads:
        answer = await create_record(
            app_context.client,
            table_id,
            ts="2026-10-02T00:00:00Z",
            values={TEMPERATURE: 26, LOAD: 431},
        )
    assert isinstance(
        answer["record"]["computed"]["预测"], (int, float)
    ), answer
    assert reads == [0]


@pytest.mark.parametrize(
    "operation", ["edit", "correct", "clear", "clear_range"]
)
async def test_edits_and_corrections_download_models_outside_the_transaction(
    app_context: AppContext, monkeypatch: pytest.MonkeyPatch, operation: str
) -> None:
    client = app_context.client
    table_id = await a_model_table(app_context)
    await create_column(
        client, table_id, key="表计", source="point", node_key=NODE_KEY
    )
    record = data_of(await client.get(records_url(table_id)))["items"][0]
    route = overrides_url(table_id, record["row_id"], record["ts"])
    correction = {"values": {"表计": 9}, "reason": "合成核对"}
    if operation in {"clear", "clear_range"}:
        prepared = await client.put(route, json=correction)
        assert prepared.status_code == HTTP_OK, prepared.text
    with observe_download(app_context, monkeypatch) as reads:
        if operation == "edit":
            response = await client.patch(
                records_url(table_id) + "/" + record["row_id"],
                params={"ts": record["ts"]},
                json={"values": {LOAD: 450}},
            )
        elif operation == "correct":
            response = await client.put(route, json=correction)
        elif operation == "clear":
            response = await client.delete(route)
        else:
            response = await client.post(
                f"{TABLES}/{table_id}/overrides:clear",
                json={"column_keys": ["表计"]},
            )
    assert response.status_code == HTTP_OK, response.text
    stored = data_of(await client.get(records_url(table_id)))["items"][0]
    assert isinstance(stored["computed"]["预测"], (int, float))
    assert reads == [0]
