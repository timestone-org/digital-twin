"""HTTP 采集配置、加密凭据与统一计划的对外契约。"""

from datetime import UTC, datetime

import httpx
import pytest
from conftest import CollectFakes
from unit.collect_fakes import (
    ACTION_BROWSE,
    ACTION_BROWSE_SUBTREE,
    ACTION_READ,
    ACTION_WRITE,
)

from integration.collect_helpers import (
    PLAN,
    POINTS,
    SOURCES,
    create_points,
    envelope,
    payload,
    point_item,
    source_body,
)
from integration.test_collect_plan_internal_api import service_headers
from platform_server.apps.collect.services import command_bus

pytestmark = pytest.mark.requires_postgres


def http_source(**overrides: object) -> dict[str, object]:
    """完整的 HTTP 数据源入参。Args: overrides。"""
    body: dict[str, object] = source_body(
        protocol="http",
        endpoint="https://api.example.test/readings",
        read_mode="poll",
        options_json={"auth_type": "none"},
    )
    body.update(overrides)
    return body


async def test_http_sources_and_multiple_points_share_the_collect_plan(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.post(SOURCES, json=http_source())
    assert response.status_code == 201
    source = payload(response)
    await create_points(
        app_client,
        source["id"],
        point_item("temperature", address="/data/items/0/temperature"),
        point_item(
            "running", address="/data/items/0/running", data_type="bool"
        ),
    )
    plan = payload(await app_client.get(PLAN, headers=service_headers()))
    planned = next(
        item for item in plan["sources"] if item["source_id"] == source["id"]
    )
    assert planned["protocol"] == "http"
    assert [point["point_code"] for point in planned["points"]] == [
        "running",
        "temperature",
    ]
    assert all(point["archive_enabled"] for point in planned["points"])
    assert all(
        point["archive_max_interval_ms"] == 60000 for point in planned["points"]
    )


@pytest.mark.parametrize(
    ("auth_type", "username", "extra"),
    [
        ("basic", "reader", {}),
        ("digest", "reader", {}),
        ("bearer", None, {}),
        ("api_key", None, {"auth_header": "X-Service-Token"}),
        (
            "oauth2_client_credentials",
            "client",
            {
                "token_endpoint": "https://api.example.test/token",
                "scope": "read",
            },
        ),
    ],
    ids=["basic", "digest", "bearer", "api-key", "oauth-client"],
)
async def test_http_auth_secrets_only_leave_the_internal_plan(
    app_client: httpx.AsyncClient,
    auth_type: str,
    username: str | None,
    extra: dict[str, str],
) -> None:
    response = await app_client.post(
        SOURCES,
        json=http_source(
            username=username,
            credential="test-only-http-secret",
            options_json={"auth_type": auth_type, **extra},
        ),
    )
    assert response.status_code == 201
    source = payload(response)
    assert source["has_credential"] is True
    assert "test-only-http-secret" not in response.text
    public = await app_client.get(f"{SOURCES}/{source['id']}")
    assert "test-only-http-secret" not in public.text
    plan = payload(await app_client.get(PLAN, headers=service_headers()))
    planned = next(
        item for item in plan["sources"] if item["source_id"] == source["id"]
    )
    assert planned["password"] == "test-only-http-secret"
    assert planned["username"] == username


@pytest.mark.parametrize(
    "overrides",
    [
        {"read_mode": "subscribe"},
        {"poll_interval_ms": 999},
        {"endpoint": "ftp://api.example.test/data"},
        {"endpoint": "https://user:pass@api.example.test/data"},
        {"endpoint": "https://api.example.test/data?token=secret"},
        {"options_json": {"auth_type": "bearer"}},
        {"options_json": {"auth_type": "basic"}, "credential": "secret"},
        {
            "options_json": {"auth_type": "oauth2_client_credentials"},
            "credential": "secret",
            "username": "client",
        },
        {"options_json": {"auth_type": "custom"}},
        {"options_json": {"method": "DELETE"}},
        {"options_json": {"body_json": "{}"}},
        {"options_json": {"headers_json": '{"Authorization":"Bearer secret"}'}},
        {"options_json": {"query_json": '{"api_key":"secret"}'}},
        {
            "options_json": {
                "method": "POST",
                "body_json": '{"password":"secret"}',
            }
        },
        {"options_json": {"headers_json": "[]"}},
        {"options_json": {"timeout_s": "11"}},
        {"options_json": {"max_response_bytes": "4194305"}},
        {"options_json": {"unknown_option": "1"}},
    ],
    ids=[
        "subscription",
        "poll-floor",
        "scheme",
        "userinfo",
        "url-secret",
        "missing-token",
        "missing-user",
        "missing-oauth-endpoint",
        "auth-type",
        "method",
        "get-body",
        "header-secret",
        "query-secret",
        "body-secret",
        "header-shape",
        "timeout",
        "response-cap",
        "unknown-option",
    ],
)
async def test_invalid_http_configuration_never_gets_saved_or_broadcast(
    app_client: httpx.AsyncClient,
    collect_fakes: CollectFakes,
    overrides: dict[str, object],
) -> None:
    response = await app_client.post(SOURCES, json=http_source(**overrides))
    assert response.status_code == 400
    assert collect_fakes.plans.published == []
    listed = payload(await app_client.get(SOURCES))
    assert listed["items"] == []


async def test_http_patch_preserves_rotates_and_clears_the_encrypted_secret(
    app_client: httpx.AsyncClient,
) -> None:
    source = payload(
        await app_client.post(
            SOURCES,
            json=http_source(
                options_json={"auth_type": "bearer"},
                credential="first-test-token",
            ),
        )
    )
    url = f"{SOURCES}/{source['id']}"
    before = payload(await app_client.get(PLAN, headers=service_headers()))
    assert (
        await app_client.patch(url, json={"name": "HTTP 二号"})
    ).status_code == 200
    unchanged = payload(await app_client.get(PLAN, headers=service_headers()))
    assert unchanged["version"] == before["version"]
    assert (
        await app_client.patch(url, json={"credential": "second-test-token"})
    ).status_code == 200
    rotated = payload(await app_client.get(PLAN, headers=service_headers()))
    assert rotated["version"] != before["version"]
    refused = await app_client.patch(url, json={"credential": None})
    assert refused.status_code == 400
    assert payload(await app_client.get(url))["has_credential"] is True
    cleared = await app_client.patch(
        url, json={"credential": None, "options_json": {"auth_type": "none"}}
    )
    assert cleared.status_code == 200
    assert payload(cleared)["has_credential"] is False


@pytest.mark.parametrize(
    "address",
    ["data.temperature", "/data/~2name", "/data/name~"],
    ids=["dot-path", "invalid-escape", "incomplete-escape"],
)
async def test_invalid_http_pointer_is_rejected_before_command_enqueue(
    app_client: httpx.AsyncClient,
    collect_fakes: CollectFakes,
    address: str,
) -> None:
    source = payload(await app_client.post(SOURCES, json=http_source()))
    response = await app_client.post(
        POINTS,
        json={
            "source_id": source["id"],
            "items": [point_item(address=address)],
        },
    )
    assert response.status_code == 400
    assert collect_fakes.bus.sent == []


async def test_http_points_allow_root_and_escaped_pointer_tokens(
    app_client: httpx.AsyncClient,
) -> None:
    source = payload(await app_client.post(SOURCES, json=http_source()))
    points = await create_points(
        app_client,
        source["id"],
        point_item("root", address="$", data_type="string"),
        point_item("escaped", address="/a~1b/~0key"),
    )
    assert [item["address"] for item in points["items"]] == ["$", "/a~1b/~0key"]


async def test_http_read_only_field_actions_never_enqueue_writes_or_browse(
    app_client: httpx.AsyncClient,
    collect_fakes: CollectFakes,
) -> None:
    source = payload(await app_client.post(SOURCES, json=http_source()))
    points = await create_points(
        app_client, source["id"], point_item(address="/value")
    )
    collect_fakes.bus.sent.clear()
    browse = await app_client.post(f"{SOURCES}/{source['id']}:browse", json={})
    subtree = await app_client.post(
        f"{SOURCES}/{source['id']}:browse-subtree", json={}
    )
    write = await app_client.post(
        f"{POINTS}/{points['items'][0]['id']}:write",
        json={"value": 9},
        headers={"Idempotency-Key": "http-write"},
    )
    assert browse.status_code == 400
    assert envelope(browse)["code"] == 41112
    assert subtree.status_code == 400
    assert envelope(subtree)["code"] == 41112
    assert write.status_code == 400
    assert envelope(write)["code"] == 41113
    assert collect_fakes.bus.envelopes_of(ACTION_BROWSE) == []
    assert collect_fakes.bus.envelopes_of(ACTION_BROWSE_SUBTREE) == []
    assert collect_fakes.bus.envelopes_of(ACTION_WRITE) == []


async def test_invalid_http_patch_keeps_the_stored_profile_and_plan(
    app_client: httpx.AsyncClient,
    collect_fakes: CollectFakes,
) -> None:
    source = payload(await app_client.post(SOURCES, json=http_source()))
    before = payload(await app_client.get(PLAN, headers=service_headers()))
    collect_fakes.plans.published.clear()
    response = await app_client.patch(
        f"{SOURCES}/{source['id']}",
        json={"endpoint": "https://api.example.test/data?token=private-value"},
    )
    assert response.status_code == 400
    assert "private-value" not in response.text
    assert collect_fakes.plans.published == []
    restored = payload(await app_client.get(f"{SOURCES}/{source['id']}"))
    assert restored["endpoint"] == source["endpoint"]
    after = payload(await app_client.get(PLAN, headers=service_headers()))
    assert after["version"] == before["version"]


async def test_http_pointer_patch_rejects_invalid_path_and_preserves_identity(
    app_client: httpx.AsyncClient,
    collect_fakes: CollectFakes,
) -> None:
    source = payload(await app_client.post(SOURCES, json=http_source()))
    batch = await create_points(
        app_client, source["id"], point_item(address="/value")
    )
    point = batch["items"][0]
    url = f"{POINTS}/{point['id']}"
    collect_fakes.bus.sent.clear()
    invalid = await app_client.patch(url, json={"address": "$.value"})
    assert invalid.status_code == 400
    assert collect_fakes.bus.sent == []
    updated = await app_client.patch(url, json={"address": "/data/new_value"})
    assert updated.status_code == 200
    saved = payload(updated)["point"]
    assert saved["address"] == "/data/new_value"
    assert saved["node_key"] == point["node_key"]


async def test_http_source_protocol_cannot_change_after_creation(
    app_client: httpx.AsyncClient,
) -> None:
    source = payload(await app_client.post(SOURCES, json=http_source()))
    response = await app_client.patch(
        f"{SOURCES}/{source['id']}", json={"protocol": "opcua"}
    )
    assert response.status_code == 400


@pytest.mark.parametrize(
    ("request_timeout", "expected_budget"), [("10", 11.0), ("1", 5.0)]
)
async def test_http_probe_budget_contains_request_timeout_and_bus_reserve(
    app_client: httpx.AsyncClient,
    collect_fakes: CollectFakes,
    monkeypatch: pytest.MonkeyPatch,
    request_timeout: str,
    expected_budget: float,
) -> None:
    monkeypatch.setattr(
        command_bus, "utcnow", lambda: datetime(2026, 1, 1, tzinfo=UTC)
    )
    source = payload(
        await app_client.post(
            SOURCES,
            json=http_source(options_json={"timeout_s": request_timeout}),
        )
    )
    collect_fakes.bus.replies[ACTION_READ] = {
        "status": "ok",
        "data": {"samples": []},
    }
    response = await app_client.post(f"{SOURCES}/{source['id']}:test")
    assert response.status_code == 200
    assert payload(response)["is_reachable"] is True
    assert collect_fakes.bus.budgets == [expected_budget]
    sent = collect_fakes.bus.envelopes_of(ACTION_READ)[0]
    assert sent["deadline_ms"] == 1767225600000 + int(expected_budget * 1000)
    assert sent["point_codes"] == []


@pytest.mark.parametrize(
    ("reason", "expected_detail"),
    [
        (
            "http_auth_rejected",
            "HTTP 接口认证或权限被拒绝，请检查凭据和上游账号权限",
        ),
        (
            "http_config_invalid",
            "HTTP 接口配置或请求被拒绝，请检查地址与请求参数",
        ),
        (
            "http_response_invalid",
            "HTTP 接口返回的数据不是可用的 JSON，或超过响应限制",
        ),
        ("http_request_failed", "HTTP 接口请求未完成，请检查网络与超时"),
    ],
    ids=["auth", "config", "response", "request"],
)
async def test_http_probe_errors_are_specific_and_do_not_echo_upstream_data(
    app_client: httpx.AsyncClient,
    collect_fakes: CollectFakes,
    reason: str,
    expected_detail: str,
) -> None:
    source = payload(await app_client.post(SOURCES, json=http_source()))
    collect_fakes.bus.replies[ACTION_READ] = {
        "status": "error",
        "reason": reason,
        "detail": "secret-upstream-body",
    }
    response = await app_client.post(f"{SOURCES}/{source['id']}:test")
    assert response.status_code == 200
    assert payload(response)["is_reachable"] is False
    assert payload(response)["detail"] == expected_detail
    assert "secret-upstream-body" not in response.text
