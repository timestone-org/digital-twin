"""部署修订、签名确认、回滚及引用守卫的数据库契约。"""

import uuid

import httpx
import pytest
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession

from integration.modeling_helpers import data_of
from integration.modeling_management_helpers import (
    seed_rule_versions,
    seed_versions,
)
from platform_server.apps.modeling.models import ModelingModelVersion

DEPLOYMENTS = "/api/v1/platform/modeling-deployments"
VERSIONS = "/api/v1/platform/modeling-model-versions"


async def deployed(client: httpx.AsyncClient, version: str) -> dict:
    response = await client.post(
        DEPLOYMENTS,
        json={
            "code": "management-service",
            "name": "管理测试",
            "model_version_id": version,
        },
    )
    assert response.status_code == 201
    return data_of(response)


async def test_switch_preserves_code_and_manual_rollback_checks_revision(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    _, versions = await seed_versions(app_client, db_session)
    deployment = await deployed(app_client, versions[0])
    url = f"{DEPLOYMENTS}/{deployment['id']}"
    switched = await app_client.post(
        f"{url}:switch",
        json={"expected_revision": 1, "model_version_id": versions[1]},
    )
    assert switched.status_code == 200, switched.text
    assert data_of(switched)["revision"] == 2
    assert data_of(switched)["code"] == "management-service"
    stale = await app_client.post(
        f"{url}:switch",
        json={"expected_revision": 1, "model_version_id": versions[0]},
    )
    assert stale.status_code == 409
    history = data_of(await app_client.get(f"{url}/switches"))["items"]
    assert len(history) == 1
    rolled_back = await app_client.post(
        f"{url}:rollback",
        json={"expected_revision": 2, "switch_id": history[0]["id"]},
    )
    assert rolled_back.status_code == 200
    assert data_of(rolled_back)["model_version_id"] == versions[0]
    assert data_of(rolled_back)["revision"] == 3


async def test_signature_change_requires_confirmation_and_keeps_history(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    _, versions = await seed_versions(app_client, db_session)
    target = await db_session.get(ModelingModelVersion, uuid.UUID(versions[1]))
    assert target is not None
    target.signature_json = {
        "inputs": [{"key": "other", "dtype": "number"}],
        "output": {"task": "regression"},
    }
    await db_session.commit()
    deployment = await deployed(app_client, versions[0])
    url = f"{DEPLOYMENTS}/{deployment['id']}"
    command = {"expected_revision": 1, "model_version_id": versions[1]}
    assert (
        await app_client.post(f"{url}:switch", json=command)
    ).status_code == 409
    command["is_signature_change_confirmed"] = True
    switched = await app_client.post(f"{url}:switch", json=command)
    assert switched.status_code == 200
    history = data_of(await app_client.get(f"{url}/switches"))["items"]
    assert history[0]["is_signature_change_confirmed"] is True


async def test_archive_refuses_live_references_and_restores_inactive_version(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    instance, versions = await seed_versions(app_client, db_session)
    await deployed(app_client, versions[0])
    used = await app_client.post(f"{VERSIONS}/{versions[0]}:archive")
    assert used.status_code == 409
    blocked = await app_client.post(
        f"/api/v1/platform/modeling-instances/{instance}:archive", json={}
    )
    assert blocked.status_code == 409
    archived = await app_client.post(f"{VERSIONS}/{versions[1]}:archive")
    assert archived.status_code == 200
    assert data_of(archived)["archived_at"] is not None
    restored = await app_client.post(f"{VERSIONS}/{versions[1]}:restore")
    assert restored.status_code == 200
    assert data_of(restored)["archived_at"] is None


async def test_version_and_run_lists_expose_instance_and_publication_links(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    instance, versions = await seed_versions(app_client, db_session)
    deployment = await deployed(app_client, versions[0])
    listed = data_of(
        await app_client.get(VERSIONS, params={"instance_id": instance})
    )
    assert len(listed["items"]) == 2
    assert all(item["instance_id"] == instance for item in listed["items"])
    first = next(item for item in listed["items"] if item["id"] == versions[0])
    assert first["deployment_count"] == 1
    linked = data_of(await app_client.get(first["deployments_url"]))
    assert linked["items"][0]["id"] == deployment["id"]
    runs = data_of(
        await app_client.get(
            "/api/v1/platform/modeling-runs",
            params={"instance_id": instance, "status": "succeeded"},
        )
    )
    assert {item["published_version_id"] for item in runs["items"]} == set(
        versions
    )
    detail = data_of(await app_client.get(f"{VERSIONS}/{versions[0]}"))
    assert detail["instance_id"] == instance
    assert detail["deployment_count"] == 1
    run = data_of(
        await app_client.get(
            f"/api/v1/platform/modeling-runs/{detail['run_id']}"
        )
    )
    assert run["instance_id"] == instance
    assert run["published_version_id"] == versions[0]


async def test_retirement_reports_deployment_and_switch_history_as_conflict(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    _, versions = await seed_versions(app_client, db_session)
    deployment = await deployed(app_client, versions[0])
    assert (
        await app_client.delete(f"{VERSIONS}/{versions[0]}")
    ).status_code == 409
    url = f"{DEPLOYMENTS}/{deployment['id']}"
    assert (
        await app_client.post(
            f"{url}:switch",
            json={"expected_revision": 1, "model_version_id": versions[1]},
        )
    ).status_code == 200
    assert (await app_client.delete(url)).status_code == 204
    assert (
        await app_client.delete(f"{VERSIONS}/{versions[0]}")
    ).status_code == 409


async def test_version_deployment_query_uses_constant_sql_count(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    _, versions = await seed_versions(app_client, db_session)
    await deployed(app_client, versions[0])
    statements: list[str] = []

    def record(
        _connection: object, _cursor: object, statement: str, *_rest: object
    ) -> None:
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    assert db_session.bind is not None
    engine = db_session.bind.sync_engine
    event.listen(engine, "before_cursor_execute", record)
    try:
        path = f"{VERSIONS}/{versions[0]}/deployments"
        assert (await app_client.get(path)).status_code == 200
        single_count = len(statements)
        for number in range(3):
            response = await app_client.post(
                DEPLOYMENTS,
                json={
                    "code": f"extra-{number}",
                    "name": "附加",
                    "model_version_id": versions[0],
                },
            )
            assert response.status_code == 201
        statements.clear()
        selected = data_of(await app_client.get(path))
        assert len(selected["items"]) == 4
        assert len(statements) == single_count
    finally:
        event.remove(engine, "before_cursor_execute", record)


async def test_rule_result_kind_change_requires_confirmation(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    instance, _ = await seed_versions(app_client, db_session)
    versions = await seed_rule_versions(db_session, instance)
    deployment = await deployed(app_client, versions[0])
    path = f"{DEPLOYMENTS}/{deployment['id']}:switch"
    payload = {"expected_revision": 1, "model_version_id": versions[1]}
    refused = await app_client.post(path, json=payload)
    assert refused.status_code == 409
    payload["is_signature_change_confirmed"] = True
    confirmed = await app_client.post(path, json=payload)
    assert confirmed.status_code == 200


async def test_deployment_filters_keep_disabled_and_multiple_services(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
) -> None:
    instance, versions = await seed_versions(app_client, db_session)
    first = await deployed(app_client, versions[0])
    second = await app_client.post(
        DEPLOYMENTS,
        json={
            "code": "second-service",
            "name": "第二服务",
            "model_version_id": versions[0],
        },
    )
    assert second.status_code == 201
    disabled = await app_client.patch(
        f"{DEPLOYMENTS}/{first['id']}",
        json={"is_enabled": False, "expected_revision": 1},
    )
    assert disabled.status_code == 200
    shared = data_of(
        await app_client.get(
            DEPLOYMENTS, params={"model_version_id": versions[0]}
        )
    )
    assert len(shared) == 2
    selected = data_of(
        await app_client.get(
            DEPLOYMENTS,
            params={
                "code": "management-service",
                "model_version_id": versions[0],
                "instance_id": instance,
                "is_enabled": "false",
            },
        )
    )
    assert [item["id"] for item in selected] == [first["id"]]
    assert selected[0]["is_enabled"] is False
    empty = data_of(
        await app_client.get(DEPLOYMENTS, params={"code": "missing-service"})
    )
    assert empty == []


@pytest.mark.parametrize(
    "query",
    [
        {"model_version_id": "invalid"},
        {"instance_id": "invalid"},
        {"is_enabled": "invalid"},
        {"code": "invalid/code"},
    ],
    ids=["version-uuid", "instance-uuid", "boolean", "code"],
)
async def test_deployment_filter_rejects_invalid_identity(
    app_client: httpx.AsyncClient, query: dict
) -> None:
    response = await app_client.get(DEPLOYMENTS, params=query)
    assert response.status_code == 400
