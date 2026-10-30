"""实例归档、历史筛选和部署版本切换的公开契约。"""

import httpx
import pytest
from conftest import SignHeaders

from integration.modeling_helpers import data_of
from integration.test_modeling_templates import INSTANCES, make_instance


async def test_instance_cursor_contract_preserves_legacy_page(
    app_client: httpx.AsyncClient,
) -> None:
    instance = await make_instance(app_client)
    legacy = data_of(await app_client.get(INSTANCES))
    assert legacy["items"][0]["id"] == instance["id"]
    assert {"page", "size", "total"} <= legacy.keys()
    response = await app_client.get(
        INSTANCES, params={"pagination": "cursor", "limit": 1}
    )
    assert response.status_code == 200
    cursor = data_of(response)
    assert cursor["has_more"] is False
    assert cursor["next"] is None
    assert "total" not in cursor


async def test_archived_instance_is_recoverable_and_cannot_train(
    app_client: httpx.AsyncClient,
) -> None:
    instance = await make_instance(app_client)
    url = f"{INSTANCES}/{instance['id']}"
    response = await app_client.post(f"{url}:archive", json={})
    assert response.status_code == 200
    assert data_of(response)["archived_at"] is not None
    assert data_of(await app_client.get(INSTANCES))["items"] == []
    selected = await app_client.get(INSTANCES, params={"archived": "archived"})
    assert data_of(selected)["items"][0]["id"] == instance["id"]
    blocked = await app_client.post(f"{url}:train", json={"trigger": "api"})
    assert blocked.status_code == 409
    restored = await app_client.post(f"{url}:restore", json={})
    assert restored.status_code == 200
    assert data_of(restored)["archived_at"] is None


async def test_history_query_rejects_conflicting_instance_identity(
    app_client: httpx.AsyncClient,
) -> None:
    instance = await make_instance(app_client)
    response = await app_client.get(
        "/api/v1/platform/modeling-runs",
        params={
            "instance_id": instance["id"],
            "pipeline_id": "01900000-0000-7000-8000-000000000001",
        },
    )
    assert response.status_code == 400


async def test_instance_cursor_ignores_new_inserts_and_rejects_filter_reuse(
    app_client: httpx.AsyncClient,
) -> None:
    first = await make_instance(app_client)
    second = data_of(
        await app_client.post(
            INSTANCES,
            json={
                "template_id": first["template_id"],
                "code": "second",
                "name": "second",
            },
        )
    )
    selected = data_of(
        await app_client.get(
            INSTANCES, params={"pagination": "cursor", "limit": 1}
        )
    )
    assert selected["items"][0]["id"] == second["id"]
    await app_client.post(
        INSTANCES,
        json={
            "template_id": first["template_id"],
            "code": "third",
            "name": "third",
        },
    )
    following = data_of(
        await app_client.get(
            INSTANCES,
            params={
                "pagination": "cursor",
                "limit": 1,
                "after": selected["next"],
            },
        )
    )
    assert [item["id"] for item in following["items"]] == [first["id"]]
    rejected = await app_client.get(
        INSTANCES,
        params={
            "pagination": "cursor",
            "q": "other",
            "after": selected["next"],
        },
    )
    assert rejected.status_code == 400


@pytest.mark.parametrize(
    "query",
    [
        {"pagination": "cursor", "after": "invalid"},
        {"limit": 201},
        {"pagination": "bad"},
    ],
    ids=["malformed-cursor", "over-limit", "bad-mode"],
)
async def test_management_query_rejects_invalid_bounds(
    app_client: httpx.AsyncClient, query: dict
) -> None:
    response = await app_client.get(INSTANCES, params=query)
    assert response.status_code == 400


async def test_archive_blocks_configuration_and_generic_training_bypass(
    app_client: httpx.AsyncClient,
) -> None:
    instance = await make_instance(app_client)
    url = f"{INSTANCES}/{instance['id']}"
    configuration = data_of(await app_client.get(f"{url}/configuration"))[
        "configuration"
    ]
    await app_client.post(f"{url}:archive", json={})
    configured = await app_client.put(
        f"{url}/configuration",
        json={"expected_revision": 2, "configuration": configuration},
    )
    assert configured.status_code == 409
    bypass = await app_client.post(
        f"/api/v1/platform/modeling-pipelines/{instance['id']}:run",
        json={"trigger": "api"},
    )
    assert bypass.status_code == 409
    assert (await app_client.get(f"{url}/configuration")).status_code == 200


async def test_archive_rejects_view_only_and_inflight_run(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    instance = await make_instance(app_client)
    url = f"{INSTANCES}/{instance['id']}"
    denied = await app_client.post(
        f"{url}:archive", json={}, headers=sign(("modeling:view",))
    )
    assert denied.status_code == 403
    started = await app_client.post(f"{url}:train", json={"trigger": "api"})
    assert started.status_code == 202
    blocked = await app_client.post(f"{url}:archive", json={})
    assert blocked.status_code == 409
