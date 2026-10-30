"""管理筛选、归档边界、非法换版和切换历史续页。"""

import uuid
from datetime import UTC, datetime

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from integration.modeling_helpers import data_of
from integration.modeling_management_helpers import (
    seed_rule_versions,
    seed_versions,
)
from integration.test_modeling_deployment_switches import (
    DEPLOYMENTS,
    VERSIONS,
    deployed,
)
from integration.test_modeling_templates import INSTANCES, make_instance
from lib.errors import ValidationFailed
from lib.web import CursorPage, encode_cursor
from platform_server.apps.modeling.crud import model_version_crud
from platform_server.apps.modeling.models import (
    ModelingInstance,
    ModelingModelVersion,
)
from platform_server.apps.modeling.schemas.deployment import (
    ModelDeploymentUpdateIn,
)
from platform_server.apps.modeling.schemas.management import (
    CursorListQuery,
    DeploymentListQuery,
    InstanceListQuery,
    RunListQuery,
    VersionListQuery,
)
from platform_server.apps.modeling.services import (
    deployment_service,
    management_queries,
)
from platform_server.apps.modeling.services.management_cursor import (
    query_fingerprint,
)

MISSING = "01900000-0000-7000-8000-000000000001"


async def test_instance_and_run_filters_compose_with_real_status(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    identity, _ = await seed_versions(app_client, db_session)
    instance = data_of(await app_client.get(f"{INSTANCES}/{identity}"))
    query = {
        "q": "一号机",
        "code": "energy-k1",
        "template_id": instance["template_id"],
        "latest_run_status": "succeeded",
        "has_runs": "true",
    }
    result = data_of(await app_client.get(INSTANCES, params=query))
    assert [row["id"] for row in result["items"]] == [identity]
    assert (
        data_of(await app_client.get(INSTANCES, params={"has_runs": "false"}))[
            "items"
        ]
        == []
    )
    runs = await app_client.get(
        "/api/v1/platform/modeling-runs",
        params={
            "instance_id": identity,
            "q": "一号机",
            "status": "succeeded",
            "created_at__gte": "2020-01-01T00:00:00Z",
            "created_at__lt": "2030-01-01T00:00:00Z",
        },
    )
    assert len(data_of(runs)["items"]) == 2


async def test_version_filters_select_archived_and_unservable_models(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    identity, versions = await seed_versions(app_client, db_session)
    second = await db_session.get(ModelingModelVersion, uuid.UUID(versions[1]))
    assert second is not None
    second.servable = False
    second.unservable_reason = "评估未达标"
    await db_session.commit()
    archived = await app_client.post(f"{VERSIONS}/{versions[0]}:archive")
    assert archived.status_code == 200
    query = {
        "instance_id": identity,
        "q": "版本",
        "task": "regression",
        "is_servable": "true",
        "archived": "archived",
        "created_at__gte": "2020-01-01T00:00:00Z",
        "created_at__lt": "2030-01-01T00:00:00Z",
    }
    result = data_of(await app_client.get(VERSIONS, params=query))
    assert [row["id"] for row in result["items"]] == [versions[0]]
    failed = data_of(
        await app_client.get(
            VERSIONS, params={"is_servable": "false", "archived": "all"}
        )
    )
    assert [row["id"] for row in failed["items"]] == [versions[1]]


@pytest.mark.parametrize(
    "query",
    [
        {"created_at__gte": "2026-01-01T00:00:00"},
        {
            "created_at__gte": "2027-01-01T00:00:00Z",
            "created_at__lt": "2026-01-01T00:00:00Z",
        },
        {"after": "cursor"},
    ],
    ids=["naive-time", "reversed-range", "cursor-on-page"],
)
async def test_history_query_rejects_ambiguous_time_and_page_mode(
    app_client: httpx.AsyncClient, query: dict
) -> None:
    response = await app_client.get(
        "/api/v1/platform/modeling-runs", params=query
    )
    assert response.status_code == 400


async def test_archive_is_repeatable_and_stale_revision_is_rejected(
    app_client: httpx.AsyncClient,
) -> None:
    instance = await make_instance(app_client)
    url = f"{INSTANCES}/{instance['id']}"
    stale = await app_client.post(
        f"{url}:archive", json={"expected_revision": 99}
    )
    assert stale.status_code == 409
    restored = data_of(await app_client.post(f"{url}:restore", json={}))
    assert restored["revision"] == 1
    archived = data_of(await app_client.post(f"{url}:archive", json={}))
    repeated = data_of(await app_client.post(f"{url}:archive", json={}))
    assert repeated["archived_at"] == archived["archived_at"]
    assert repeated["revision"] == archived["revision"]


@pytest.mark.parametrize(
    "path",
    [f"{INSTANCES}/{MISSING}:archive", f"{VERSIONS}/{MISSING}:archive"],
    ids=["instance", "version"],
)
async def test_archive_missing_resource_returns_not_found(
    app_client: httpx.AsyncClient, path: str
) -> None:
    assert (await app_client.post(path, json={})).status_code == 404


async def test_switch_rejects_archived_unservable_missing_and_other_task(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    identity, versions = await seed_versions(app_client, db_session)
    deployment = await deployed(app_client, versions[0])
    path = f"{DEPLOYMENTS}/{deployment['id']}:switch"
    command = {"expected_revision": 1, "model_version_id": versions[1]}
    assert (
        await app_client.post(f"{VERSIONS}/{versions[1]}:archive")
    ).status_code == 200
    assert (await app_client.post(path, json=command)).status_code == 409
    await app_client.post(f"{VERSIONS}/{versions[1]}:restore")
    row = await db_session.get(ModelingModelVersion, uuid.UUID(versions[1]))
    assert row is not None
    row.servable, row.unservable_reason = False, "未通过评估"
    await db_session.commit()
    assert (await app_client.post(path, json=command)).status_code == 409
    assert (
        await app_client.post(
            path, json={**command, "model_version_id": MISSING}
        )
    ).status_code == 404
    rules = await seed_rule_versions(db_session, identity)
    assert (
        await app_client.post(
            path, json={**command, "model_version_id": rules[0]}
        )
    ).status_code == 409


async def test_same_version_switch_keeps_revision_and_history_empty(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    _, versions = await seed_versions(app_client, db_session)
    deployment = await deployed(app_client, versions[0])
    url = f"{DEPLOYMENTS}/{deployment['id']}"
    result = await app_client.post(
        f"{url}:switch",
        json={"expected_revision": 1, "model_version_id": versions[0]},
    )
    assert result.status_code == 200
    assert data_of(result)["revision"] == 1
    assert data_of(await app_client.get(f"{url}/switches"))["items"] == []
    stale = await app_client.patch(
        url, json={"expected_revision": 99, "is_enabled": False}
    )
    assert stale.status_code == 409


async def test_rollback_history_belongs_to_deployment_and_supports_cursor(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    _, versions = await seed_versions(app_client, db_session)
    deployment = await deployed(app_client, versions[0])
    other = data_of(
        await app_client.post(
            DEPLOYMENTS,
            json={
                "code": "other-service",
                "name": "其他",
                "model_version_id": versions[0],
            },
        )
    )
    url = f"{DEPLOYMENTS}/{deployment['id']}"
    await app_client.post(
        f"{url}:switch",
        json={"expected_revision": 1, "model_version_id": versions[1]},
    )
    history = data_of(await app_client.get(f"{url}/switches"))["items"]
    rollback = {"expected_revision": 2, "switch_id": history[0]["id"]}
    rejected = await app_client.post(
        f"{DEPLOYMENTS}/{other['id']}:rollback",
        json={**rollback, "expected_revision": 1},
    )
    assert rejected.status_code == 404
    assert (
        await app_client.post(f"{url}:rollback", json=rollback)
    ).status_code == 200
    first = data_of(
        await app_client.get(f"{url}/switches", params={"limit": 1})
    )
    assert first["has_more"] is True
    following = data_of(
        await app_client.get(
            f"{url}/switches", params={"limit": 1, "after": first["next"]}
        )
    )
    assert following["has_more"] is False
    assert first["items"][0]["id"] != following["items"][0]["id"]


async def test_instance_latest_run_keeps_identity_and_publication_links(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
) -> None:
    identity, versions = await seed_versions(app_client, db_session)
    expected: dict[str, str] = {}
    for version_id in versions:
        version = data_of(await app_client.get(f"{VERSIONS}/{version_id}"))
        expected[version["run_id"]] = version_id
    detail = data_of(await app_client.get(f"{INSTANCES}/{identity}"))
    listed = data_of(await app_client.get(INSTANCES))["items"][0]
    configured = data_of(
        await app_client.get(f"{INSTANCES}/{identity}/configuration")
    )["instance"]
    for instance in (detail, listed, configured):
        latest = instance["latest_run"]
        assert latest["instance_id"] == identity
        assert latest["published_version_id"] == expected[latest["id"]]


async def test_page_mode_keeps_real_version_and_run_relationships(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    identity, versions = await seed_versions(app_client, db_session)
    await app_client.post(
        DEPLOYMENTS,
        json={
            "code": "legacy-related",
            "name": "关联",
            "model_version_id": versions[0],
        },
    )
    listed = await management_queries.list_versions(
        db_session, VersionListQuery(pipeline_id=identity)
    )
    assert {str(row.id): row.deployment_count for row in listed.items} == {
        versions[0]: 1,
        versions[1]: 0,
    }
    runs = await management_queries.list_runs(
        db_session, RunListQuery(pipeline_id=identity)
    )
    assert {str(row.published_version_id) for row in runs.items} == set(
        versions
    )
    assert all(row.instance_id == uuid.UUID(identity) for row in runs.items)
    expected_runs = frozenset(row.id for row in runs.items)
    assert (
        await model_version_crud.published_run_ids(db_session, None)
        == expected_runs
    )
    assert (
        await model_version_crud.count_of_pipeline(
            db_session, uuid.UUID(identity)
        )
        == 2
    )


async def test_history_queries_without_filters_include_rule_versions(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    identity, trained = await seed_versions(app_client, db_session)
    rules = await seed_rule_versions(db_session, identity)
    await db_session.commit()
    runs = await management_queries.list_runs(db_session, RunListQuery())
    assert len(runs.items) == 4
    selected = await management_queries.list_runs(
        db_session, RunListQuery(pipeline_id=identity)
    )
    assert {row.id for row in selected.items} == {row.id for row in runs.items}
    first = await management_queries.list_versions(
        db_session, VersionListQuery(pagination="cursor", limit=2)
    )
    assert isinstance(first, CursorPage)
    assert first.has_more is True
    assert first.next is not None
    second = await management_queries.list_versions(
        db_session,
        VersionListQuery(pagination="cursor", limit=2, after=first.next),
    )
    assert {str(row.id) for row in [*first.items, *second.items]} == set(
        trained + rules
    )
    assert all(
        row.instance_id == uuid.UUID(identity)
        for row in [*first.items, *second.items]
    )


async def test_archive_filters_retain_instances_and_versions_in_all_scope(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    identity, versions = await seed_versions(app_client, db_session)
    instance = await db_session.get(ModelingInstance, uuid.UUID(identity))
    version = await db_session.get(ModelingModelVersion, uuid.UUID(versions[0]))
    assert instance is not None
    assert version is not None
    instance.archived_at = datetime(2026, 10, 30, tzinfo=UTC)
    version.archived_at = datetime(2026, 10, 30, tzinfo=UTC)
    await db_session.commit()
    for scope in ("all", "archived"):
        found = await management_queries.list_instances(
            db_session, InstanceListQuery(archived=scope)
        )
        assert [str(row.id) for row in found.items] == [identity]
    archived = await management_queries.list_versions(
        db_session, VersionListQuery(pipeline_id=identity, archived="archived")
    )
    assert [str(row.id) for row in archived.items] == [versions[0]]
    all_versions = await management_queries.list_versions(
        db_session, VersionListQuery(archived="all")
    )
    assert {str(row.id) for row in all_versions.items} == set(versions)


async def test_deployment_projection_keeps_patch_metadata_and_exact_filters(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    _, versions = await seed_versions(app_client, db_session)
    created = await deployed(app_client, versions[0])
    identity = uuid.UUID(created["id"])
    changed = await deployment_service.update_deployment(
        db_session,
        deployment_id=identity,
        payload=ModelDeploymentUpdateIn(
            expected_revision=1,
            name="新名称",
            description="维护说明",
            model_version_id=versions[1],
            max_rows_per_call=3,
            rate_limit_per_minute=5,
            is_enabled=False,
        ),
    )
    assert (changed.name, changed.description, changed.max_rows_per_call) == (
        "新名称",
        "维护说明",
        3,
    )
    assert (
        changed.rate_limit_per_minute,
        changed.is_enabled,
        changed.revision,
    ) == (
        5,
        False,
        2,
    )
    assert str(changed.model_version_id) == versions[1]
    unfiltered = await management_queries.list_deployments(
        db_session, DeploymentListQuery()
    )
    assert [row.id for row in unfiltered] == [identity]
    public = data_of(await app_client.get(DEPLOYMENTS))
    assert [row["id"] for row in public] == [str(identity)]
    linked = await management_queries.list_version_deployments(
        db_session, uuid.UUID(versions[1]), CursorListQuery(q="新名称")
    )
    assert [row.id for row in linked.items] == [identity]
    excluded = await management_queries.list_deployments(
        db_session, DeploymentListQuery(is_enabled=True)
    )
    assert excluded == []


async def test_cursor_rejects_naive_time_even_with_matching_query_scope(
    db_session: AsyncSession,
) -> None:
    query = InstanceListQuery(pagination="cursor")
    query = query.model_copy(
        update={
            "after": encode_cursor(
                {
                    "scope": query_fingerprint(query, "instances"),
                    "created_at": "2026-10-30T00:00:00",
                    "id": "01900000-0000-7000-8000-000000000001",
                }
            )
        }
    )
    with pytest.raises(ValidationFailed, match="游标无效"):
        await management_queries.list_instances(db_session, query)


async def test_deployment_rejects_a_missing_version_with_domain_error(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.post(
        DEPLOYMENTS,
        json={
            "code": "missing-version",
            "name": "未知版本",
            "model_version_id": "01900000-0000-7000-8000-000000000001",
        },
    )
    assert response.status_code == 404
    assert response.json()["code"] == 41409


@pytest.mark.parametrize("operation", ["retire_version", "delete_deployment"])
async def test_delete_command_replays_empty_http_and_retains_resource_receipt(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    operation: str,
) -> None:
    _, versions = await seed_versions(app_client, db_session)
    if operation == "retire_version":
        resource_id, path = versions[1], VERSIONS
    else:
        deployment = await deployed(app_client, versions[0])
        resource_id, path = deployment["id"], DEPLOYMENTS
    headers = {"Idempotency-Key": f"delete-recovery-{operation}"}
    endpoint = f"{path}/{resource_id}"
    removed = await app_client.delete(endpoint, headers=headers)
    assert removed.status_code == 204
    assert removed.content == b""
    repeated = await app_client.delete(endpoint, headers=headers)
    assert repeated.status_code == 204
    assert repeated.content == b""
    receipt = data_of(
        await app_client.get(
            "/api/v1/platform/modeling-commands",
            headers=headers,
            params={"operation": operation, "resource_id": resource_id},
        )
    )
    assert receipt["state"] == "succeeded"
    assert receipt["http_status"] == 204
    assert receipt["result"] == {"id": resource_id}
    assert receipt["id"] == removed.headers["Modeling-Command-Id"]
    assert (await app_client.get(endpoint)).status_code == 404


async def test_public_version_links_resolve_when_present(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    identity, versions = await seed_versions(app_client, db_session)
    detail = data_of(await app_client.get(f"{VERSIONS}/{versions[0]}"))
    listed = data_of(
        await app_client.get(VERSIONS, params={"pipeline_id": identity})
    )["items"]
    assert listed
    for version in (detail, *listed):
        assert version["instance_id"] == identity
        if version["deployments_url"] is not None:
            linked = await app_client.get(version["deployments_url"])
            assert linked.status_code == 200
