"""真实 PostgreSQL 上的流水线 JSON 预检、独立导入与导出。"""

from collections.abc import Callable

import httpx
import pytest

from integration.modeling_helpers import (
    PIPELINES,
    create_pipeline,
    data_of,
    node,
)

pytestmark = pytest.mark.requires_postgres


async def test_transfer_actions_require_design_permission(
    app_client: httpx.AsyncClient, sign: Callable[..., dict[str, str]]
) -> None:
    document = await exported(app_client)
    app_client.headers.update(sign(codes=["modeling:view"]))
    for suffix, payload in (
        (":inspect-import", document),
        (":import", {"document": document, "code": "denied", "name": "无权限"}),
        ("/00000000-0000-0000-0000-000000000000:export", {}),
    ):
        response = await app_client.post(f"{PIPELINES}{suffix}", json=payload)
        assert response.status_code == 403


def graph(
    operator: str = "ledger_source", **config: object
) -> dict[str, object]:
    return {
        "format_version": "1.0",
        "nodes": [node("source", operator, **config)],
        "edges": [],
    }


async def exported(client: httpx.AsyncClient) -> dict[str, object]:
    created = await create_pipeline(
        client,
        "portable",
        graph(table_code="missing_here", columns=["温度", "能耗"]),
    )
    response = await client.post(f"{PIPELINES}/{created['id']}:export")
    assert response.status_code == 200, response.text
    return data_of(response)


async def test_transfer_roundtrip_creates_independent_definition(
    app_client: httpx.AsyncClient,
) -> None:
    document = await exported(app_client)
    assert set(document) == {"format_version", "pipeline", "operators"}
    assert document["operators"] == [
        {"operator": "ledger_source", "spec_version": "1.1"}
    ]
    checked = await app_client.post(
        f"{PIPELINES}:inspect-import", json=document
    )
    assert checked.status_code == 200, checked.text
    report = data_of(checked)
    assert report["can_import"] is True
    assert report["source_table_codes"] == ["missing_here"]
    assert any(
        "当前系统没有台账" in item["message"] for item in report["issues"]
    )
    payload = {
        "document": document,
        "code": "portable_copy",
        "name": "异地导入",
        "description": "独立设计",
    }
    headers = {"Idempotency-Key": "transfer-one"}
    first = await app_client.post(
        f"{PIPELINES}:import", json=payload, headers=headers
    )
    second = await app_client.post(
        f"{PIPELINES}:import", json=payload, headers=headers
    )
    assert first.status_code == second.status_code == 201
    assert data_of(first)["id"] == data_of(second)["id"]
    assert data_of(first)["graph"] == document["pipeline"]["graph"]
    assert data_of(first)["code"] == "portable_copy"
    assert data_of(first)["name"] == "异地导入"
    conflict = await app_client.post(f"{PIPELINES}:import", json=payload)
    assert conflict.status_code == 409


async def test_blank_saved_graph_roundtrips_as_a_configuration_draft(
    app_client: httpx.AsyncClient,
) -> None:
    created = await create_pipeline(
        app_client, "blank", {"format_version": "1.0", "nodes": [], "edges": []}
    )
    document = data_of(
        await app_client.post(f"{PIPELINES}/{created['id']}:export")
    )
    checked = data_of(
        await app_client.post(f"{PIPELINES}:inspect-import", json=document)
    )
    assert checked["can_import"] is True
    assert any(issue["level"] == "warning" for issue in checked["issues"])
    imported = await app_client.post(
        f"{PIPELINES}:import",
        json={"document": document, "code": "blank_copy", "name": "空草稿副本"},
    )
    assert imported.status_code == 201
    assert data_of(imported)["graph"] == document["pipeline"]["graph"]


async def test_import_key_rejects_changed_parameters_and_recovers_receipt(
    app_client: httpx.AsyncClient,
) -> None:
    document = await exported(app_client)
    payload = {
        "document": document,
        "code": "import_command",
        "name": "命令导入",
    }
    headers = {"Idempotency-Key": "import-parameter-fingerprint"}
    first = await app_client.post(
        f"{PIPELINES}:import", json=payload, headers=headers
    )
    assert first.status_code == 201
    changed = await app_client.post(
        f"{PIPELINES}:import",
        json={**payload, "code": "changed_code"},
        headers=headers,
    )
    assert changed.status_code == 409
    replay = await app_client.post(
        f"{PIPELINES}:import", json=payload, headers=headers
    )
    assert data_of(replay)["id"] == data_of(first)["id"]
    assert (
        first.headers["modeling-command-id"]
        == replay.headers["modeling-command-id"]
    )
    receipt = await app_client.get(
        "/api/v1/platform/modeling-commands",
        params={"operation": "import_pipeline"},
        headers=headers,
    )
    assert receipt.status_code == 200
    assert data_of(receipt)["state"] == "succeeded"
    assert data_of(receipt)["result"]["id"] == data_of(first)["id"]


@pytest.mark.parametrize(
    ("operator", "config"),
    [
        ("unknown_operator", {}),
        (
            "ledger_source",
            {"table_code": "energy", "api_key": "must_not_export"},
        ),
        (
            "ledger_source",
            {"table_code": {"url": "example", "api_key": "must_not_export"}},
        ),
    ],
)
async def test_unknown_saved_operator_or_parameters_cannot_be_silently_exported(
    app_client: httpx.AsyncClient, operator: str, config: dict[str, object]
) -> None:
    created = await create_pipeline(
        app_client, "unknown_saved", graph(operator, **config)
    )
    response = await app_client.post(f"{PIPELINES}/{created['id']}:export")
    assert response.status_code == 400
    assert "must_not_export" not in response.text


async def test_invalid_topology_never_creates_a_pipeline(
    app_client: httpx.AsyncClient,
) -> None:
    document = await exported(app_client)
    document["pipeline"]["graph"]["edges"] = [
        {
            "id": "bad",
            "from_node": "absent",
            "from_port": "frame",
            "to_node": "source",
            "to_port": "frame",
        }
    ]
    checked = data_of(
        await app_client.post(f"{PIPELINES}:inspect-import", json=document)
    )
    assert checked["can_import"] is False
    response = await app_client.post(
        f"{PIPELINES}:import",
        json={"document": document, "code": "must_not_exist", "name": "非法图"},
    )
    assert response.status_code == 400
    listed = data_of(
        await app_client.get(PIPELINES, params={"q": "must_not_exist"})
    )
    assert listed["total"] == 0


@pytest.mark.parametrize(
    ("field", "value"), [("format_version", "9.0"), ("runs", [])]
)
async def test_invalid_document_envelope_is_rejected(
    app_client: httpx.AsyncClient, field: str, value: object
) -> None:
    document = await exported(app_client)
    document[field] = value
    response = await app_client.post(
        f"{PIPELINES}:inspect-import", json=document
    )
    assert response.status_code == 400
