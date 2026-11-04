"""工作流单一部署、训练发布状态和安全删除的数据库契约。"""

import uuid

import httpx
from conftest import SignHeaders
from sqlalchemy.ext.asyncio import AsyncSession
from unit.database_fakes import MakerSessions

from integration.modeling_helpers import data_of, drive_run
from integration.modeling_management_helpers import seed_versions
from integration.test_modeling_publication import _trained
from platform_server.apps.modeling.models import (
    ModelingDeployment,
    ModelingModelVersion,
    ModelingRun,
)
from platform_server.apps.modeling.services.workflow_publication import (
    complete_training,
)

RUNS = "/api/v1/platform/modeling-runs"
DEPLOYMENTS = "/api/v1/platform/modeling-deployments"


async def test_workflow_runs_deploy_to_one_stable_endpoint(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    _, versions = await seed_versions(app_client, db_session)
    first = await db_session.get(ModelingModelVersion, uuid.UUID(versions[0]))
    second = await db_session.get(ModelingModelVersion, uuid.UUID(versions[1]))
    assert first is not None
    assert second is not None
    created = await app_client.post(f"{RUNS}/{first.run_id}:deploy", json={})
    assert created.status_code == 200, created.text
    deployed = data_of(created)
    switched = await app_client.post(f"{RUNS}/{second.run_id}:deploy", json={})
    assert switched.status_code == 200, switched.text
    assert data_of(switched)["id"] == deployed["id"]
    assert data_of(switched)["code"] == deployed["code"]
    assert data_of(switched)["model_version_id"] == versions[1]
    assert len(data_of(await app_client.get(DEPLOYMENTS))) == 1


async def test_second_workflow_endpoint_is_rejected(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    _, versions = await seed_versions(app_client, db_session)
    payload = {"code": "first", "name": "首个", "model_version_id": versions[0]}
    assert (await app_client.post(DEPLOYMENTS, json=payload)).status_code == 201
    payload["code"] = "second"
    refused = await app_client.post(DEPLOYMENTS, json=payload)
    assert refused.status_code == 409


async def test_delete_training_removes_unreferenced_model_atomically(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    _, versions = await seed_versions(app_client, db_session)
    version = await db_session.get(ModelingModelVersion, uuid.UUID(versions[1]))
    assert version is not None
    run_id = version.run_id
    deleted = await app_client.delete(f"{RUNS}/{run_id}")
    assert deleted.status_code == 204, deleted.text
    assert (await app_client.get(f"{RUNS}/{run_id}")).status_code == 404
    model = await app_client.get(
        f"/api/v1/platform/modeling-model-versions/{versions[1]}"
    )
    assert model.status_code == 404


async def test_delete_deployed_training_is_rejected_without_partial_deletion(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    _, versions = await seed_versions(app_client, db_session)
    version = await db_session.get(ModelingModelVersion, uuid.UUID(versions[0]))
    assert version is not None
    run_id = version.run_id
    assert (
        await app_client.post(f"{RUNS}/{run_id}:deploy", json={})
    ).status_code == 200
    refused = await app_client.delete(f"{RUNS}/{run_id}")
    assert refused.status_code == 409
    assert (await app_client.get(f"{RUNS}/{run_id}")).status_code == 200


async def test_delete_active_training_is_rejected(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    identity, _ = await seed_versions(app_client, db_session)
    row = ModelingRun(
        pipeline_id=uuid.UUID(identity),
        status="pending",
        graph_snapshot={},
        trigger="api",
    )
    db_session.add(row)
    await db_session.commit()
    assert (await app_client.delete(f"{RUNS}/{row.id}")).status_code == 409


async def test_auto_publication_reuses_one_version_and_one_endpoint(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    identity, versions = await seed_versions(app_client, db_session)
    model = await db_session.get(ModelingModelVersion, uuid.UUID(versions[0]))
    assert model is not None
    run = await db_session.get(ModelingRun, model.run_id)
    assert run is not None
    run.auto_publish = True
    run.publication_status = "pending"
    run.publication_expected_revision = 0
    await db_session.commit()
    await complete_training(worker_sessions, run.id)
    await complete_training(worker_sessions, run.id)
    answer = data_of(await app_client.get(f"{RUNS}/{run.id}"))
    assert answer["publication_status"] == "published"
    assert answer["published_version_id"] == versions[0]
    listed = data_of(await app_client.get(DEPLOYMENTS))
    assert len(listed) == 1
    models = data_of(
        await app_client.get(
            "/api/v1/platform/modeling-model-versions",
            params={"pipeline_id": identity},
        )
    )
    assert models["total"] == 2


async def test_auto_publication_preserves_a_deployment_modified_during_training(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    _, versions = await seed_versions(app_client, db_session)
    first = await db_session.get(ModelingModelVersion, uuid.UUID(versions[0]))
    second = await db_session.get(ModelingModelVersion, uuid.UUID(versions[1]))
    assert first is not None
    assert second is not None
    deployed = data_of(
        await app_client.post(f"{RUNS}/{first.run_id}:deploy", json={})
    )
    run = await db_session.get(ModelingRun, second.run_id)
    assert run is not None
    run.auto_publish = True
    run.publication_status = "pending"
    run.publication_expected_revision = deployed["revision"]
    run.publication_deployment_id = uuid.UUID(deployed["id"])
    await db_session.commit()
    await app_client.patch(
        f"{DEPLOYMENTS}/{deployed['id']}", json={"name": "人工更新"}
    )
    await complete_training(worker_sessions, run.id)
    result = data_of(await app_client.get(f"{RUNS}/{run.id}"))
    assert result["status"] == "succeeded"
    assert result["publication_status"] == "failed"
    assert "训练期间" in result["publication_error"]
    current = data_of(await app_client.get(f"{DEPLOYMENTS}/{deployed['id']}"))
    assert current["model_version_id"] == versions[0]


async def test_auto_publication_refuses_changed_signature_until_confirmation(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    _, versions = await seed_versions(app_client, db_session)
    first = await db_session.get(ModelingModelVersion, uuid.UUID(versions[0]))
    second = await db_session.get(ModelingModelVersion, uuid.UUID(versions[1]))
    assert first is not None
    assert second is not None
    deployed = data_of(
        await app_client.post(f"{RUNS}/{first.run_id}:deploy", json={})
    )
    second.signature_json = {"inputs": [{"key": "new", "dtype": "number"}]}
    run = await db_session.get(ModelingRun, second.run_id)
    assert run is not None
    run.auto_publish = True
    run.publication_status = "pending"
    run.publication_expected_revision = deployed["revision"]
    run.publication_deployment_id = uuid.UUID(deployed["id"])
    await db_session.commit()
    await complete_training(worker_sessions, run.id)
    state = data_of(await app_client.get(f"{RUNS}/{run.id}"))
    assert state["publication_status"] == "failed"
    assert "签名" in state["publication_error"]
    confirmed = await app_client.post(
        f"{RUNS}/{run.id}:deploy", json={"is_signature_change_confirmed": True}
    )
    assert confirmed.status_code == 200, confirmed.text
    assert data_of(confirmed)["id"] == deployed["id"]
    assert data_of(confirmed)["model_version_id"] == versions[1]


async def test_training_with_auto_publication_requires_publish_permission(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    sign: SignHeaders,
) -> None:
    identity, _ = await seed_versions(app_client, db_session)
    headers = sign(codes=["modeling:run", "modeling:view"])
    refused = await app_client.post(
        f"/api/v1/platform/modeling-pipelines/{identity}:run",
        json={"auto_publish": True},
        headers=headers,
    )
    assert refused.status_code == 403


async def test_successful_training_freezes_model_without_publishing(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    run = await _trained(app_client, db_session, worker_sessions)
    result = data_of(await app_client.get(f"{RUNS}/{run['id']}"))
    assert result["published_version_id"] is not None
    assert result["publication_status"] == "not_requested"
    assert data_of(await app_client.get(DEPLOYMENTS)) == []


async def test_finished_run_redelivery_completes_pending_publication(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    _, versions = await seed_versions(app_client, db_session)
    model = await db_session.get(ModelingModelVersion, uuid.UUID(versions[0]))
    assert model is not None
    run = await db_session.get(ModelingRun, model.run_id)
    assert run is not None
    run.auto_publish = True
    run.publication_status = "pending"
    run.publication_expected_revision = 0
    await db_session.commit()
    report = await drive_run(worker_sessions, run.id)
    assert report.outcome == "orphaned"
    answer = data_of(await app_client.get(f"{RUNS}/{run.id}"))
    assert answer["publication_status"] == "published"
    assert answer["published_version_id"] == versions[0]


async def test_pending_model_publication_blocks_the_next_training(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
) -> None:
    identity, versions = await seed_versions(app_client, db_session)
    model = await db_session.get(ModelingModelVersion, uuid.UUID(versions[0]))
    assert model is not None
    run = await db_session.get(ModelingRun, model.run_id)
    assert run is not None
    run.publication_status = "pending"
    await db_session.commit()
    refused = await app_client.post(
        f"/api/v1/platform/modeling-pipelines/{identity}:run",
        json={},
    )
    assert refused.status_code == 409
    assert refused.json()["code"] == 41406


async def test_legacy_multiple_deployments_require_explicit_cleanup(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
) -> None:
    _, versions = await seed_versions(app_client, db_session)
    model = await db_session.get(ModelingModelVersion, uuid.UUID(versions[0]))
    assert model is not None
    db_session.add_all(
        [
            ModelingDeployment(
                code=f"legacy-{number}",
                name="历史入口",
                model_version_id=model.id,
            )
            for number in (1, 2)
        ]
    )
    await db_session.commit()
    refused = await app_client.post(f"{RUNS}/{model.run_id}:deploy", json={})
    assert refused.status_code == 409
    assert refused.json()["code"] == 41438
