"""模板独立保存、历史实例快照与安全删除的真实数据库回归。"""

import uuid

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from integration.modeling_helpers import PIPELINES, data_of
from integration.modeling_management_helpers import seed_versions
from integration.test_modeling_templates import (
    INSTANCES,
    TEMPLATES,
    make_instance,
    make_template,
)
from platform_server.apps.modeling.crud import pipeline_crud
from platform_server.apps.modeling.errors import PipelineHasVersions
from platform_server.apps.modeling.models import ModelingRun
from platform_server.apps.modeling.models.template import (
    ModelingConfigurationAudit,
)

pytestmark = pytest.mark.requires_postgres


async def test_deleted_design_preserves_versions_and_existing_instances(
    app_client: httpx.AsyncClient,
) -> None:
    instance = await make_instance(app_client)
    template = data_of(
        await app_client.get(f"{TEMPLATES}/{instance['template_id']}")
    )
    source_id = template["pipeline_id"]
    second = await app_client.post(
        TEMPLATES, json={"pipeline_id": source_id, "name": "第二版快照"}
    )
    assert second.status_code == 201, second.text
    deleted = await app_client.delete(f"{PIPELINES}/{source_id}")
    assert deleted.status_code == 204, deleted.text
    assert (await app_client.get(f"{PIPELINES}/{source_id}")).status_code == 404
    listed = data_of(await app_client.get(TEMPLATES))
    assert listed["total"] == 2
    assert {row["version"] for row in listed["items"]} == {1, 2}
    assert all(row["pipeline_id"] is None for row in listed["items"])
    for snapshot in (template, data_of(second)):
        detail = data_of(await app_client.get(f"{TEMPLATES}/{snapshot['id']}"))
        assert detail == {**snapshot, "pipeline_id": None}
    preserved = data_of(
        await app_client.get(f"{INSTANCES}/{instance['id']}/configuration")
    )
    assert preserved["instance"]["template_id"] == template["id"]
    assert preserved["configuration"]["nodes"]["s"]["table_code"] == (
        "energy-data"
    )


async def test_detached_template_creates_independent_editable_workflow(
    app_client: httpx.AsyncClient,
) -> None:
    template = await make_template(app_client)
    configuration_url = f"{TEMPLATES}/{template['id']}/configuration"
    expected = data_of(await app_client.get(configuration_url))
    deleted = await app_client.delete(f"{PIPELINES}/{template['pipeline_id']}")
    assert deleted.status_code == 204, deleted.text
    assert data_of(await app_client.get(configuration_url)) == expected
    response = await app_client.post(
        f"{TEMPLATES}/{template['id']}:create-workflow",
        json={"code": "detached-copy", "name": "独立模板创建"},
    )
    assert response.status_code == 201, response.text
    workflow = data_of(response)
    assert {
        node["id"]: node["config"] for node in workflow["graph"]["nodes"]
    } == (expected["configuration"]["nodes"])
    changed = await app_client.patch(
        f"{PIPELINES}/{workflow['id']}", json={"name": "可继续编辑"}
    )
    assert changed.status_code == 200
    assert data_of(await app_client.get(configuration_url)) == expected


async def test_historical_instance_can_publish_its_current_configuration(
    app_client: httpx.AsyncClient,
) -> None:
    instance = await make_instance(app_client)
    original_url = f"{TEMPLATES}/{instance['template_id']}/configuration"
    original = data_of(await app_client.get(original_url))
    instance_url = f"{INSTANCES}/{instance['id']}/configuration"
    configuration = data_of(await app_client.get(instance_url))["configuration"]
    configuration["nodes"]["s"]["table_code"] = "instance-only-data"
    updated = await app_client.put(
        instance_url,
        json={"expected_revision": 1, "configuration": configuration},
    )
    assert updated.status_code == 200
    published = await app_client.post(
        TEMPLATES,
        json={"pipeline_id": instance["id"], "name": "实例配置独立模板"},
    )
    assert published.status_code == 201, published.text
    snapshot = data_of(published)
    deleted = await app_client.delete(f"{PIPELINES}/{instance['id']}")
    assert deleted.status_code == 204, deleted.text
    assert (await app_client.get(instance_url)).status_code == 404
    assert data_of(await app_client.get(original_url)) == original
    detail = data_of(await app_client.get(f"{TEMPLATES}/{snapshot['id']}"))
    assert detail["pipeline_id"] is None
    snapshot_config = data_of(
        await app_client.get(f"{TEMPLATES}/{snapshot['id']}/configuration")
    )
    assert snapshot_config["configuration"] == configuration


@pytest.mark.parametrize(
    ("status", "publication_status"),
    [
        ("pending", None),
        ("running", None),
        ("cancelling", None),
        ("succeeded", "pending"),
    ],
)
async def test_instance_deletion_preserves_unfinished_training_and_templates(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    status: str,
    publication_status: str | None,
) -> None:
    instance = await make_instance(app_client)
    run = ModelingRun(
        pipeline_id=uuid.UUID(str(instance["id"])),
        status=status,
        publication_status=publication_status,
        graph_snapshot={},
        trigger="manual",
    )
    db_session.add(run)
    await db_session.commit()
    refused = await app_client.delete(f"{PIPELINES}/{instance['id']}")
    assert refused.status_code == 409, refused.text
    assert (
        await app_client.get(f"{INSTANCES}/{instance['id']}")
    ).status_code == (200)
    assert data_of(await app_client.get(TEMPLATES))["total"] == 1


async def test_model_versions_protect_instance_and_its_published_template(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    identity, _versions = await seed_versions(app_client, db_session)
    published = await app_client.post(
        TEMPLATES, json={"pipeline_id": identity, "name": "仍有模型的实例"}
    )
    assert published.status_code == 201, published.text
    snapshot = data_of(published)
    refused = await app_client.delete(f"{PIPELINES}/{identity}")
    assert refused.status_code == 409, refused.text
    assert (await app_client.get(f"{INSTANCES}/{identity}")).status_code == 200
    assert data_of(await app_client.get(f"{TEMPLATES}/{snapshot['id']}")) == (
        snapshot
    )


async def test_deletion_audits_detachment_in_the_same_transaction(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    template = await make_template(app_client)
    source_id = str(template["pipeline_id"])
    deleted = await app_client.delete(f"{PIPELINES}/{source_id}")
    assert deleted.status_code == 204, deleted.text
    audits = list(
        await db_session.scalars(
            select(ModelingConfigurationAudit).where(
                ModelingConfigurationAudit.action == "workflow_deleted",
                ModelingConfigurationAudit.target_id == uuid.UUID(source_id),
            )
        )
    )
    assert len(audits) == 1
    assert audits[0].actor_id == app_client.headers["X-Auth-User-Id"]
    assert audits[0].before_json == {
        "code": template["code"],
        "template_ids": [str(template["id"])],
        "instance_template_id": None,
    }
    assert audits[0].after_json is None


@pytest.mark.parametrize("is_instance", [False, True])
async def test_failed_deletion_rolls_back_template_and_instance_changes(
    app_client: httpx.AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
    is_instance: bool,
) -> None:
    instance = await make_instance(app_client)
    template = data_of(
        await app_client.get(f"{TEMPLATES}/{instance['template_id']}")
    )
    if is_instance:
        snapshot = await app_client.post(
            TEMPLATES,
            json={"pipeline_id": instance["id"], "name": "失败清理的快照"},
        )
        assert snapshot.status_code == 201, snapshot.text
        template = data_of(snapshot)

    async def refuse_delete(*_args: object) -> None:
        raise PipelineHasVersions("模拟删除失败")

    monkeypatch.setattr(pipeline_crud, "delete", refuse_delete)
    refused = await app_client.delete(f"{PIPELINES}/{template['pipeline_id']}")
    assert refused.status_code == 409
    assert data_of(await app_client.get(f"{TEMPLATES}/{template['id']}")) == (
        template
    )
    assert (
        await app_client.get(f"{INSTANCES}/{instance['id']}")
    ).status_code == (200)
