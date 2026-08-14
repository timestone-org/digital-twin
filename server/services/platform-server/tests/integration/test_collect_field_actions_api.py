"""要往现场跑一趟的三件事：连通性测试、地址空间浏览、下发写值。

守的是「平台侧不建连接、全部经命令总线」，以及「写值必须带幂等键且超时不许
自动重试」。
"""

import httpx
import pytest
from conftest import CollectFakes
from unit.collect_fakes import ACTION_BROWSE, ACTION_READ, ACTION_WRITE

from integration.collect_helpers import (
    POINTS,
    SOURCES,
    create_points,
    create_source,
    envelope,
    payload,
)

pytestmark = pytest.mark.requires_postgres

WRITE_KEY = {"Idempotency-Key": "write-1"}


async def test_a_reachable_source_answers_200_with_a_verdict(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    source = await create_source(app_client)
    collect_fakes.bus.replies[ACTION_READ] = {
        "status": "ok",
        "data": {"samples": []},
    }
    response = await app_client.post(f"{SOURCES}/{source['id']}:test")
    assert response.status_code == 200
    result = payload(response)
    assert result["is_reachable"] is True
    assert result["detail"] is None


async def test_an_offline_source_is_a_verdict_not_an_error(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    source = await create_source(app_client)
    collect_fakes.bus.replies[ACTION_READ] = {
        "status": "error",
        "reason": "source_offline",
    }
    response = await app_client.post(f"{SOURCES}/{source['id']}:test")
    assert response.status_code == 200
    result = payload(response)
    assert result["is_reachable"] is False
    assert result["detail"] == "采集侧还没连上这个数据源"


async def test_a_silent_collector_is_reported_as_unreachable(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_source(app_client)
    response = await app_client.post(f"{SOURCES}/{source['id']}:test")
    result = payload(response)
    assert result["is_reachable"] is False
    assert result["detail"] == "采集侧没有答复，请先确认采集进程在运行"


async def test_browsing_asks_the_collector_and_maps_the_items(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    source = await create_source(app_client)
    collect_fakes.bus.replies[ACTION_BROWSE] = {
        "status": "ok",
        "data": {
            "items": [
                {
                    "address": "ns=2;s=Temp1",
                    "name": "出口温度",
                    "has_children": False,
                    "is_variable": True,
                }
            ]
        },
    }
    response = await app_client.post(
        f"{SOURCES}/{source['id']}:browse", json={"parent": "ns=2;s=Root"}
    )
    assert response.status_code == 200
    assert payload(response)["items"][0]["address"] == "ns=2;s=Temp1"
    envelope_sent = collect_fakes.bus.envelopes_of(ACTION_BROWSE)[0]
    assert envelope_sent["parent"] == "ns=2;s=Root"
    assert envelope_sent["source_id"] == source["id"]


async def test_browsing_an_unsupported_protocol_is_not_an_empty_tree(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    source = await create_source(app_client)
    collect_fakes.bus.replies[ACTION_BROWSE] = {
        "status": "error",
        "reason": "browse_unsupported",
    }
    response = await app_client.post(
        f"{SOURCES}/{source['id']}:browse", json={}
    )
    assert response.status_code == 400
    assert envelope(response)["code"] == 41112


async def test_browsing_a_silent_collector_answers_503(
    app_client: httpx.AsyncClient,
) -> None:
    source = await create_source(app_client)
    response = await app_client.post(
        f"{SOURCES}/{source['id']}:browse", json={}
    )
    assert response.status_code == 503
    assert envelope(response)["code"] == 51101


async def test_browsing_an_unknown_source_reads_back_404(
    app_client: httpx.AsyncClient,
) -> None:
    missing = "0192f0c0-0000-7000-8000-00000000dead"
    response = await app_client.post(f"{SOURCES}/{missing}:browse", json={})
    assert response.status_code == 404


async def test_a_write_without_an_idempotency_key_is_refused(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    source = await create_source(app_client)
    batch = await create_points(app_client, source["id"])
    collect_fakes.bus.replies[ACTION_WRITE] = {"status": "ok", "data": {}}
    response = await app_client.post(
        f"{POINTS}/{batch['items'][0]['id']}:write", json={"value": 21.5}
    )
    assert response.status_code == 400
    assert envelope(response)["code"] == 41114
    assert collect_fakes.bus.envelopes_of(ACTION_WRITE) == []


async def test_a_write_reaches_the_field_with_the_point_code(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    source = await create_source(app_client)
    batch = await create_points(app_client, source["id"])
    collect_fakes.bus.replies[ACTION_WRITE] = {"status": "ok", "data": {}}
    response = await app_client.post(
        f"{POINTS}/{batch['items'][0]['id']}:write",
        json={"value": 21.5},
        headers=WRITE_KEY,
    )
    assert response.status_code == 200
    result = payload(response)
    assert result["is_written"] is True
    assert result["node_key"] == f"{source['id']}:outlet_temp"
    sent = collect_fakes.bus.envelopes_of(ACTION_WRITE)[0]
    assert sent["point_code"] == "outlet_temp"
    assert sent["value"] == 21.5


async def test_the_same_write_key_reaches_the_field_only_once(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    source = await create_source(app_client)
    batch = await create_points(app_client, source["id"])
    collect_fakes.bus.replies[ACTION_WRITE] = {"status": "ok", "data": {}}
    url = f"{POINTS}/{batch['items'][0]['id']}:write"
    await app_client.post(url, json={"value": 1}, headers=WRITE_KEY)
    second = await app_client.post(url, json={"value": 1}, headers=WRITE_KEY)
    assert second.status_code == 200
    assert len(collect_fakes.bus.envelopes_of(ACTION_WRITE)) == 1


async def test_a_write_timeout_is_reported_as_not_retryable(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    source = await create_source(app_client)
    batch = await create_points(app_client, source["id"])
    collect_fakes.bus.sent.clear()
    response = await app_client.post(
        f"{POINTS}/{batch['items'][0]['id']}:write",
        json={"value": 1},
        headers=WRITE_KEY,
    )
    assert response.status_code == 503
    assert envelope(response)["code"] == 51101
    # ⚠ 只发一次：这条链路上没有任何一层重试，超时不代表现场没写成功
    assert len(collect_fakes.bus.envelopes_of(ACTION_WRITE)) == 1


async def test_a_refused_write_maps_to_its_own_code(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    source = await create_source(app_client)
    batch = await create_points(app_client, source["id"])
    collect_fakes.bus.replies[ACTION_WRITE] = {
        "status": "error",
        "reason": "write_unsupported",
    }
    response = await app_client.post(
        f"{POINTS}/{batch['items'][0]['id']}:write",
        json={"value": 1},
        headers=WRITE_KEY,
    )
    assert response.status_code == 400
    assert envelope(response)["code"] == 41113
