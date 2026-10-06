"""完整版本保留兼容读取与安全删除，解除临时配置写入守卫。"""

import uuid

import pytest
from conftest import AppContext, CollectFakes
from sqlalchemy import text

from integration.collect_helpers import POINTS, SOURCES, payload
from integration.http_compatibility_helpers import seeded_http
from platform_server.apps.collect.services.point_search import PointSearch

pytestmark = pytest.mark.requires_postgres


async def test_http_source_and_point_search_remain_readable(
    app_context: AppContext, collect_fakes: CollectFakes
) -> None:
    rows = await seeded_http(app_context, collect_fakes)
    for url in (SOURCES, f"{SOURCES}/{rows.source_id}"):
        response = await app_context.client.get(url)
        assert response.status_code == 200
        result = payload(response)
        source = result["items"][0] if url == SOURCES else result
        assert source["protocol"] == "http"
        assert "credential" not in source
    found = await PointSearch(app_context.sessions, None).search(
        "出口温度", uuid.UUID(rows.source_id), 6
    )
    assert [point.source_protocol for point in found.items] == ["http"]


async def test_complete_version_allows_http_config_and_point_updates(
    app_context: AppContext, collect_fakes: CollectFakes
) -> None:
    rows = await seeded_http(app_context, collect_fakes)
    response = await app_context.client.patch(
        f"{SOURCES}/{rows.source_id}",
        json={"endpoint": "http://data.test/new", "is_enabled": True},
    )
    assert response.status_code == 200
    assert payload(response)["is_enabled"] is True
    response = await app_context.client.patch(
        f"{POINTS}/{rows.point_id}", json={"address": "/new"}
    )
    assert response.status_code == 200
    assert collect_fakes.bus.sent[0]["action"] == "validate"
    assert len(collect_fakes.plans.published) == 2


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
