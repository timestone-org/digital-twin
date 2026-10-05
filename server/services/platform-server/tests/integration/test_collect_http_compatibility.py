"""兼容平台读取未来 HTTP 行，但拒绝尚未支持的操作且不投总线。"""

import uuid

import pytest
from conftest import AppContext, CollectFakes
from sqlalchemy import text

from integration.collect_helpers import (
    POINTS,
    SOURCES,
    payload,
    point_item,
    source_body,
)
from integration.http_compatibility_helpers import seeded_http
from platform_server.apps.collect.services.point_search import PointSearch

pytestmark = pytest.mark.requires_postgres


async def test_existing_http_source_and_point_search_remain_readable(
    app_context: AppContext, collect_fakes: CollectFakes
) -> None:
    rows = await seeded_http(app_context, collect_fakes)
    for url in (SOURCES, f"{SOURCES}/{rows.source_id}"):
        response = await app_context.client.get(url)
        assert response.status_code == 200
        result = payload(response)
        source = result["items"][0] if url == SOURCES else result
        assert source["protocol"] == "http"
    found = await PointSearch(app_context.sessions, None).search(
        "出口温度", uuid.UUID(rows.source_id), 6
    )
    assert [point.source_protocol for point in found.items] == ["http"]


async def test_http_creation_is_still_rejected(
    app_context: AppContext, collect_fakes: CollectFakes
) -> None:
    response = await app_context.client.post(
        SOURCES, json=source_body(protocol="http", endpoint="http://data.test")
    )
    assert response.status_code == 400
    assert collect_fakes.bus.sent == []
    assert collect_fakes.plans.published == []


@pytest.mark.parametrize(
    "changes",
    [
        {"endpoint": "http://other.test"},
        {"credential": "replacement"},
        {"options_json": {"auth_type": "bearer"}},
        {"is_enabled": True},
        {"is_enabled": False, "endpoint": "http://other.test"},
    ],
)
async def test_http_connection_changes_are_rejected_without_notification(
    app_context: AppContext,
    collect_fakes: CollectFakes,
    changes: dict[str, object],
) -> None:
    rows = await seeded_http(app_context, collect_fakes)
    response = await app_context.client.patch(
        f"{SOURCES}/{rows.source_id}", json=changes
    )
    assert response.status_code == 400
    assert response.json()["code"] == 41110
    assert collect_fakes.bus.sent == []
    assert collect_fakes.plans.published == []
    current = payload(
        await app_context.client.get(f"{SOURCES}/{rows.source_id}")
    )
    assert current["endpoint"] == "http://data.test/data"
    assert current["is_enabled"] is True


@pytest.mark.parametrize(
    "action", ["test", "browse", "browse-subtree", "write"]
)
async def test_http_field_operations_are_rejected_before_bus(
    app_context: AppContext, collect_fakes: CollectFakes, action: str
) -> None:
    rows = await seeded_http(app_context, collect_fakes)
    url = (
        f"{POINTS}/{rows.point_id}:write"
        if action == "write"
        else f"{SOURCES}/{rows.source_id}:{action}"
    )
    response = await app_context.client.post(
        url,
        json={"value": 1} if action == "write" else {},
        headers={"Idempotency-Key": "http-compatibility-write"},
    )
    assert response.status_code == 400
    assert collect_fakes.bus.sent == []
    assert collect_fakes.plans.published == []


@pytest.mark.parametrize("changes", [{"address": "/new"}, {"name": "新名字"}])
async def test_http_point_edit_is_rejected_before_bus(
    app_context: AppContext,
    collect_fakes: CollectFakes,
    changes: dict[str, object],
) -> None:
    rows = await seeded_http(app_context, collect_fakes)
    response = await app_context.client.patch(
        f"{POINTS}/{rows.point_id}", json=changes
    )
    assert response.status_code == 400
    assert response.json()["code"] == 41111
    assert collect_fakes.bus.sent == []
    assert collect_fakes.plans.published == []


async def test_http_point_create_is_rejected_before_bus(
    app_context: AppContext, collect_fakes: CollectFakes
) -> None:
    rows = await seeded_http(app_context, collect_fakes)
    response = await app_context.client.post(
        POINTS, json={"source_id": rows.source_id, "items": [point_item("new")]}
    )
    assert response.status_code == 400
    assert response.json()["code"] == 41111
    assert collect_fakes.bus.sent == []
    assert collect_fakes.plans.published == []


async def test_http_can_be_disabled_and_deleted_with_existing_guards(
    app_context: AppContext, collect_fakes: CollectFakes
) -> None:
    rows = await seeded_http(app_context, collect_fakes)
    response = await app_context.client.patch(
        f"{SOURCES}/{rows.source_id}", json={"is_enabled": False}
    )
    assert response.status_code == 200
    assert payload(response)["protocol"] == "http"
    assert payload(response)["is_enabled"] is False
    assert collect_fakes.bus.sent == []
    assert len(collect_fakes.plans.published) == 1
    guarded = await app_context.client.delete(f"{SOURCES}/{rows.source_id}")
    assert guarded.status_code == 409
    deleted = await app_context.client.delete(f"{POINTS}/{rows.point_id}")
    assert deleted.status_code == 204
    deleted = await app_context.client.delete(f"{SOURCES}/{rows.source_id}")
    assert deleted.status_code == 204


@pytest.mark.parametrize("is_forced", [False, True])
async def test_http_config_deletion_keeps_archived_history(
    app_context: AppContext, collect_fakes: CollectFakes, is_forced: bool
) -> None:
    rows = await seeded_http(app_context, collect_fakes)
    await app_context.session.execute(
        text(
            "INSERT INTO collect.point_history"
            " (source_id, point_code, ts, value_num, quality)"
            " VALUES (:id, 'outlet_temp', now(), 42, 'good')"
        ),
        {"id": rows.source_id},
    )
    if not is_forced:
        response = await app_context.client.delete(f"{POINTS}/{rows.point_id}")
        assert response.status_code == 204
    response = await app_context.client.delete(
        f"{SOURCES}/{rows.source_id}", params={"force": str(is_forced).lower()}
    )
    assert response.status_code == 204
    assert (
        await app_context.session.scalar(
            text(
                "SELECT count(*) FROM collect.point_history"
                " WHERE source_id = :id"
            ),
            {"id": rows.source_id},
        )
        == 1
    )
