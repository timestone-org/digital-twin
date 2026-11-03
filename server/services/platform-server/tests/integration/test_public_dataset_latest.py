"""公开票据只允许读取本屏已绑定台账列的最新生效值。"""

from dataclasses import dataclass
from typing import Any

import httpx
import pytest
from conftest import AppContext
from sqlalchemy import event

from integration.dashboard_helpers import (
    DASHBOARDS_URL,
    NODES_URL,
    make_dashboard,
    make_node,
    make_project,
    node_body,
)
from integration.dataset_helpers import (
    create_column,
    create_record,
    create_table,
    data_of,
)
from integration.test_dashboard_share_api import strip_identity

pytestmark = pytest.mark.requires_postgres
MOMENT = "2026-08-23T10:00:00.000Z"
PUBLIC = "/api/v1/platform/public-dashboards"


@dataclass(frozen=True)
class PublicScreen:
    dashboard_id: str
    node_id: str
    token: str

    @property
    def url(self) -> str:
        return f"{PUBLIC}/{self.token}/dataset-latest"


async def screen(client: httpx.AsyncClient) -> PublicScreen:
    project_id = await make_project(client)
    dashboard = await make_dashboard(client, project_id=project_id)
    node = await make_node(
        client,
        dashboard_id=dashboard["id"],
        body=node_body(module_type="twin-view"),
    )
    response = await client.post(f"{DASHBOARDS_URL}/{dashboard['id']}:publish")
    assert response.status_code == 200
    return PublicScreen(
        str(dashboard["id"]), str(node["id"]), data_of(response)["public_token"]
    )


async def bind(
    client: httpx.AsyncClient, public: PublicScreen, keys: list[str]
) -> None:
    for index, key in enumerate(keys):
        response = await client.post(
            f"{NODES_URL}/{public.node_id}/bindings",
            json={
                "field_key": f"anchorValues[{index}].value",
                "source_kind": "dataset",
                "detail_json": {"dataset_key": key, "range": "today"},
            },
        )
        assert response.status_code == 201, response.text


async def effective_table(app_client: httpx.AsyncClient) -> str:
    """创建有修正、公式与未绑定列的两条数据。Args: app_client。"""
    table = await create_table(app_client, code="public_energy")
    await create_column(
        app_client,
        table["id"],
        key="shown",
        source="point",
        node_key="0192f0c0-0000-7000-8000-00000000abcd:outlet_temp",
    )
    await create_column(
        app_client,
        table["id"],
        key="double",
        source="formula",
        formula="{shown} * 2",
    )
    await create_column(app_client, table["id"], key="private")
    await create_record(
        app_client,
        table["id"],
        ts="2026-08-23T09:00:00.000Z",
        values={"shown": 1, "private": 9123},
    )
    await create_record(
        app_client, table["id"], ts=MOMENT, values={"shown": 5, "private": 9123}
    )
    return str(table["id"])


async def test_public_latest_contains_only_bound_effective_columns(
    app_client: httpx.AsyncClient,
) -> None:
    table_id = await effective_table(app_client)
    public = await screen(app_client)
    await bind(
        app_client,
        public,
        [
            "ds:public_energy:shown",
            "ds:public_energy:double",
            "ds:public_energy:shown",
        ],
    )
    strip_identity(app_client)

    response = await app_client.get(public.url)

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    items = data_of(response)["items"]
    assert [item["dataset_key"] for item in items] == [
        "ds:public_energy:double",
        "ds:public_energy:shown",
    ]
    assert [item["value"] for item in items] == [10.0, 5.0]
    assert all(
        item["status"] == "ok" and item["ts"] == MOMENT for item in items
    )
    assert all(
        item["message"] is None and item["stale_at"] is None for item in items
    )
    assert "private" not in response.text
    assert table_id not in response.text
    assert "9123" not in response.text


async def test_empty_dataset_has_an_explicit_empty_latest(
    app_client: httpx.AsyncClient,
) -> None:
    await create_table(app_client, code="public_empty")
    public = await screen(app_client)
    await bind(app_client, public, ["ds:public_empty:shown"])
    strip_identity(app_client)

    response = await app_client.get(public.url)

    assert response.status_code == 200
    assert data_of(response) == {
        "items": [
            {
                "dataset_key": "ds:public_empty:shown",
                "status": "ok",
                "value": None,
                "ts": None,
                "stale_at": None,
                "message": None,
            }
        ]
    }


@pytest.mark.parametrize("action", ["unpublish", "publish"])
async def test_revoked_or_rotated_public_ticket_cannot_read_latest(
    app_client: httpx.AsyncClient, action: str
) -> None:
    public = await screen(app_client)
    await bind(app_client, public, ["ds:public_energy:shown"])
    changed = await app_client.post(
        f"{DASHBOARDS_URL}/{public.dashboard_id}:{action}"
    )
    assert changed.status_code == 200
    strip_identity(app_client)

    response = await app_client.get(public.url)

    assert response.status_code == 404
    assert response.json()["code"] == 41016


async def test_query_parameters_cannot_select_unbound_columns(
    app_client: httpx.AsyncClient,
) -> None:
    public = await screen(app_client)
    created = await app_client.post(
        f"{NODES_URL}/{public.node_id}/bindings",
        json={
            "field_key": "anchorValues[0].value",
            "source_kind": "static",
            "static_value_json": 12,
        },
    )
    assert created.status_code == 201
    strip_identity(app_client)

    response = await app_client.get(
        public.url,
        params={
            "dataset_key": "ds:private:secret",
            "table_id": "forbidden",
            "keys": "secret",
        },
    )

    assert response.status_code == 200
    assert data_of(response) == {"items": []}


@pytest.mark.parametrize(
    ("is_enabled", "expected"),
    [(True, "2026-08-23T10:03:00.000Z"), (False, "1970-01-01T00:00:00.000Z")],
)
async def test_aggregate_latest_preserves_staleness_deadline(
    app_client: httpx.AsyncClient, is_enabled: bool, expected: str
) -> None:
    table = await create_table(
        app_client,
        code="public_aggregate",
        collect_mode="aggregate",
        collect_interval_ms=60_000,
        is_enabled=is_enabled,
    )
    await create_column(app_client, table["id"], key="shown")
    await create_record(app_client, table["id"], ts=MOMENT, values={"shown": 2})
    public = await screen(app_client)
    await bind(app_client, public, ["ds:public_aggregate:shown"])
    strip_identity(app_client)

    response = await app_client.get(public.url)

    assert response.status_code == 200
    assert data_of(response)["items"][0]["stale_at"] == expected


async def test_missing_table_and_column_have_safe_per_item_errors(
    app_client: httpx.AsyncClient,
) -> None:
    table = await create_table(app_client, code="public_present")
    await create_column(app_client, table["id"], key="shown")
    await create_record(app_client, table["id"], ts=MOMENT, values={"shown": 2})
    public = await screen(app_client)
    await bind(
        app_client,
        public,
        [
            "ds:absent:shown",
            "ds:public_present:absent",
            "malformed",
            "ds:public_present:shown",
        ],
    )
    strip_identity(app_client)

    response = await app_client.get(public.url)

    assert response.status_code == 200
    items = data_of(response)["items"]
    assert [item["status"] for item in items] == [
        "error",
        "error",
        "ok",
        "error",
    ]
    assert {item["message"] for item in items if item["status"] == "error"} == {
        "台账绑定暂不可用"
    }
    assert all(
        item["value"] is None and item["ts"] is None
        for item in items
        if item["status"] == "error"
    )


async def test_one_failed_table_does_not_abort_other_latest_reads(
    app_context: AppContext,
) -> None:
    client = app_context.client
    for code in ("a_failed", "b_healthy"):
        table = await create_table(client, code=code)
        await create_column(client, table["id"], key="shown")
        await create_record(client, table["id"], ts=MOMENT, values={"shown": 3})
    public = await screen(client)
    await bind(client, public, ["ds:a_failed:shown", "ds:b_healthy:shown"])
    strip_identity(client)
    connection = await app_context.session.connection()
    remaining = 1

    def cancel(*arguments: object) -> tuple[str, object]:
        nonlocal remaining
        statement, parameters = arguments[2:4]
        assert isinstance(statement, str)
        if "FROM platform.dataset_records" in statement and remaining:
            remaining -= 1
            return "SELECT 1 / 0", ()
        return statement, parameters

    event.listen(
        connection.sync_connection, "before_cursor_execute", cancel, retval=True
    )
    try:
        response = await client.get(public.url)
    finally:
        event.remove(
            connection.sync_connection, "before_cursor_execute", cancel
        )

    assert response.status_code == 200
    items: list[dict[str, Any]] = data_of(response)["items"]
    assert [item["status"] for item in items] == ["error", "ok"]
    assert items[1]["value"] == 3
    assert "division" not in response.text
