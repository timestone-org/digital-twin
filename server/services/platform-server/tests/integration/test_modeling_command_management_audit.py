"""接入清单中的改名、退役、删除和取消具备持久命令审计。"""

import uuid

from sqlalchemy import select, update

from integration.modeling_helpers import data_of
from integration.modeling_management_helpers import seed_versions
from integration.test_modeling_deployment_switches import (
    DEPLOYMENTS,
    VERSIONS,
    deployed,
)
from integration.test_modeling_templates import INSTANCES, make_instance
from platform_server.apps.modeling.models import ModelingRun
from platform_server.apps.modeling.models.operator_audit import (
    ModelingOperatorAudit,
)

COMMANDS = "/api/v1/platform/modeling-commands"


async def test_retirement_replays_204_and_preserves_one_audit(
    app_client, db_session
):
    _, versions = await seed_versions(app_client, db_session)
    headers = {"Idempotency-Key": "retire-once"}
    url = f"{VERSIONS}/{versions[1]}"
    first = await app_client.delete(url, headers=headers)
    replay = await app_client.delete(url, headers=headers)
    assert first.status_code == replay.status_code == 204
    assert first.content == replay.content == b""
    assert (
        first.headers["modeling-command-id"]
        == replay.headers["modeling-command-id"]
    )
    recovered = data_of(
        await app_client.get(
            COMMANDS,
            params={"operation": "retire_version", "resource_id": versions[1]},
            headers=headers,
        )
    )
    assert recovered["http_status"] == 204
    assert recovered["result"] == {"id": versions[1]}
    audits = list(
        (
            await db_session.scalars(
                select(ModelingOperatorAudit).where(
                    ModelingOperatorAudit.operation == "retire_version"
                )
            )
        ).all()
    )
    assert len(audits) == 1


async def test_deployment_delete_replays_204_and_audits_account(
    app_client, db_session
):
    _, versions = await seed_versions(app_client, db_session)
    service = await deployed(app_client, versions[0])
    headers = {"Idempotency-Key": "delete-once"}
    url = f"{DEPLOYMENTS}/{service['id']}"
    first = await app_client.delete(url, headers=headers)
    replay = await app_client.delete(url, headers=headers)
    assert first.status_code == replay.status_code == 204
    assert first.content == replay.content == b""
    audit = await db_session.scalar(
        select(ModelingOperatorAudit).where(
            ModelingOperatorAudit.operation == "delete_deployment"
        )
    )
    assert audit.account_user_id == uuid.UUID(
        app_client.headers["x-auth-user-id"]
    )
    assert audit.resource_id == uuid.UUID(service["id"])


async def test_version_metadata_is_audited_and_changed_payload_cannot_reuse_key(
    app_client, db_session
):
    _, versions = await seed_versions(app_client, db_session)
    headers = {"Idempotency-Key": "rename-once"}
    url = f"{VERSIONS}/{versions[0]}"
    first = await app_client.patch(
        url, json={"name": "新名称"}, headers=headers
    )
    replay = await app_client.patch(
        url, json={"name": "新名称"}, headers=headers
    )
    changed = await app_client.patch(
        url, json={"name": "另一名称"}, headers=headers
    )
    assert first.status_code == replay.status_code == 200
    assert changed.status_code == 409
    audits = list(
        (
            await db_session.scalars(
                select(ModelingOperatorAudit).where(
                    ModelingOperatorAudit.operation == "update_version"
                )
            )
        ).all()
    )
    assert len(audits) == 1
    assert data_of(await app_client.get(url))["name"] == "新名称"


async def test_cancel_replay_recovers_after_run_reaches_terminal_state(
    app_client, db_session
):
    instance = await make_instance(app_client)
    started = data_of(
        await app_client.post(
            f"{INSTANCES}/{instance['id']}:train", json={"trigger": "api"}
        )
    )
    url = f"/api/v1/platform/modeling-runs/{started['id']}:cancel"
    headers = {"Idempotency-Key": "cancel-once"}
    first = await app_client.post(url, headers=headers)
    assert first.status_code == 200
    await db_session.execute(
        update(ModelingRun)
        .where(ModelingRun.id == uuid.UUID(started["id"]))
        .values(status="cancelled")
    )
    await db_session.commit()
    replay = await app_client.post(url, headers=headers)
    assert replay.status_code == 200
    assert data_of(replay)["status"] == "cancelling"
    audit = await db_session.scalar(
        select(ModelingOperatorAudit).where(
            ModelingOperatorAudit.operation == "cancel_run"
        )
    )
    assert audit.resource_id == uuid.UUID(started["id"])
