"""先行读兼容的实例关系、查询过滤和部署修订契约。"""

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
from integration.test_modeling_templates import INSTANCES
from lib.errors import ValidationFailed
from lib.web import CursorPage, PageParams, encode_cursor
from platform_server.apps.modeling.crud import (
    deployment_switch as switch_records,
)
from platform_server.apps.modeling.crud import model_version_crud
from platform_server.apps.modeling.management_errors import (
    DeploymentRevisionConflict,
)
from platform_server.apps.modeling.models import (
    ModelingInstance,
    ModelingModelVersion,
)
from platform_server.apps.modeling.models.deployment_switch import (
    ModelingDeploymentSwitch,
)
from platform_server.apps.modeling.schemas.deployment import (
    ModelDeploymentUpdateIn,
)
from platform_server.apps.modeling.schemas.management import (
    CursorListQuery,
    DeploymentListQuery,
    InstanceListQuery,
    ManagementCursor,
    RunListQuery,
    VersionListQuery,
)
from platform_server.apps.modeling.services import (
    deployment_service,
    management_queries,
    model_service,
    run_service,
)
from platform_server.apps.modeling.services.management_cursor import (
    query_fingerprint,
)

VERSIONS = "/api/v1/platform/modeling-model-versions"
DEPLOYMENTS = "/api/v1/platform/modeling-deployments"


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


async def test_instance_latest_run_keeps_identity_and_publication_links(
    app_client: httpx.AsyncClient, db_session: AsyncSession
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
        assert instance["latest_run"]["instance_id"] == identity
        assert (
            instance["latest_run"]["published_version_id"]
            == expected[instance["latest_run"]["id"]]
        )


async def test_private_instance_queries_filter_and_continue_cursor(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    identity, _ = await seed_versions(app_client, db_session)
    instance = data_of(await app_client.get(f"{INSTANCES}/{identity}"))
    selected = await management_queries.list_instances(
        db_session,
        InstanceListQuery(
            q="一号机",
            code="energy-k1",
            template_id=instance["template_id"],
            has_runs=True,
            latest_run_status="succeeded",
        ),
    )
    assert [str(row.id) for row in selected.items] == [identity]
    assert (
        await management_queries.list_instances(
            db_session, InstanceListQuery(has_runs=False)
        )
    ).items == []
    second = data_of(
        await app_client.post(
            INSTANCES,
            json={
                "template_id": instance["template_id"],
                "code": "second",
                "name": "第二实例",
            },
        )
    )
    first = await management_queries.list_instances(
        db_session, InstanceListQuery(pagination="cursor", limit=1)
    )
    assert isinstance(first, CursorPage)
    assert first.has_more is True
    following = await management_queries.list_instances(
        db_session,
        InstanceListQuery(pagination="cursor", limit=1, after=first.next),
    )
    assert {str(row.id) for row in [*first.items, *following.items]} == {
        identity,
        second["id"],
    }


async def test_private_versions_and_runs_have_real_filters_and_links(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    identity, versions = await seed_versions(app_client, db_session)
    row = await db_session.get(ModelingModelVersion, uuid.UUID(versions[1]))
    assert row is not None
    row.servable, row.unservable_reason = False, "未通过评估"
    await db_session.commit()
    selected = await management_queries.list_versions(
        db_session,
        VersionListQuery(
            instance_id=identity,
            q="版本",
            task="regression",
            is_servable=False,
            created_at__gte="2020-01-01T00:00:00Z",
            created_at__lt="2030-01-01T00:00:00Z",
        ),
    )
    assert [str(row.id) for row in selected.items] == [versions[1]]
    assert selected.items[0].instance_id == uuid.UUID(identity)
    runs = await management_queries.list_runs(
        db_session,
        RunListQuery(
            instance_id=identity,
            q="一号机",
            status="succeeded",
            created_at__gte="2020-01-01T00:00:00Z",
            created_at__lt="2030-01-01T00:00:00Z",
        ),
    )
    assert {str(row.published_version_id) for row in runs.items} == set(
        versions
    )


async def test_private_deployment_filters_and_revision_match_public_schema(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    identity, versions = await seed_versions(app_client, db_session)
    created = data_of(
        await app_client.post(
            DEPLOYMENTS,
            json={
                "code": "projection-service",
                "name": "先行兼容",
                "model_version_id": versions[0],
            },
        )
    )
    changed = await deployment_service.update_deployment(
        db_session,
        deployment_id=uuid.UUID(created["id"]),
        payload=ModelDeploymentUpdateIn(expected_revision=1, is_enabled=False),
    )
    assert changed.revision == 2
    with pytest.raises(DeploymentRevisionConflict):
        await deployment_service.update_deployment(
            db_session,
            deployment_id=changed.id,
            payload=ModelDeploymentUpdateIn(
                expected_revision=1, is_enabled=True
            ),
        )
    listed = await management_queries.list_deployments(
        db_session,
        DeploymentListQuery(
            code="projection-service",
            instance_id=identity,
            model_version_id=versions[0],
            is_enabled=False,
        ),
    )
    assert [str(row.id) for row in listed] == [created["id"]]
    linked = await management_queries.list_version_deployments(
        db_session, uuid.UUID(versions[0]), CursorListQuery()
    )
    assert linked.items[0].id == changed.id


async def test_private_cursor_rejects_a_different_filter_scope(
    db_session: AsyncSession,
) -> None:
    query = InstanceListQuery(
        pagination="cursor", after="eyJzY29wZSI6Indyb25nIn0="
    )
    with pytest.raises(ValidationFailed):
        await management_queries.list_instances(db_session, query)


async def test_private_switch_records_have_stable_bounded_continuation(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
) -> None:
    _, versions = await seed_versions(app_client, db_session)
    first, second = (uuid.UUID(value) for value in versions)
    created = data_of(
        await app_client.post(
            DEPLOYMENTS,
            json={
                "code": "history-service",
                "name": "历史",
                "model_version_id": versions[0],
            },
        )
    )
    identity = uuid.UUID(created["id"])
    for minute in (1, 2):
        switch_records.add_switch(
            db_session,
            ModelingDeploymentSwitch(
                deployment_id=identity,
                deployment_code="private-history",
                from_model_id=first,
                to_model_id=second,
                revision=minute + 1,
                is_signature_change_confirmed=False,
                created_by_name="测试",
                created_at=datetime(2026, 10, 30, 0, minute, tzinfo=UTC),
            ),
        )
    await db_session.flush()
    assert await switch_records.list_switches(db_session, first, 1, None) == []
    selected = await switch_records.list_switches(db_session, identity, 1, None)
    assert len(selected) == 2
    found = await switch_records.get_switch(db_session, selected[0].id)
    assert found is not None
    assert found.id == selected[0].id
    anchor = ManagementCursor(selected[0].created_at, selected[0].id)
    following = await switch_records.list_switches(
        db_session, identity, 1, anchor
    )
    assert [row.id for row in following] == [selected[1].id]


async def test_legacy_pages_keep_real_version_and_run_relationships(
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
    listed = await model_service.list_versions(
        db_session, pipeline_id=uuid.UUID(identity), page=PageParams(1, 20)
    )
    assert {str(row.id): row.deployment_count for row in listed.items} == {
        versions[0]: 1,
        versions[1]: 0,
    }
    runs = await run_service.list_runs(
        db_session, pipeline_id=uuid.UUID(identity), page=PageParams(1, 20)
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


async def create_projection_deployment(
    client: httpx.AsyncClient, version_id: str
) -> dict:
    response = await client.post(
        DEPLOYMENTS,
        json={
            "code": "projection-filter",
            "name": "原名称",
            "model_version_id": version_id,
        },
    )
    assert response.status_code == 201
    return data_of(response)


async def test_deployment_projection_keeps_patch_metadata_and_exact_filters(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    _, versions = await seed_versions(app_client, db_session)
    created = await create_projection_deployment(app_client, versions[0])
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
    legacy = await deployment_service.list_deployments(db_session)
    assert [row.id for row in legacy] == [identity]
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
