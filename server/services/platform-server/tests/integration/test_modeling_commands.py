"""建模写命令的持久恢复、参数指纹与账号授权。"""

import json
import uuid
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Literal

import httpx
import pytest
from pydantic import BaseModel
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from integration.modeling_helpers import data_of
from integration.modeling_management_helpers import seed_versions
from integration.test_modeling_templates import INSTANCES, make_template
from lib.auth import (
    CallerContext,
    SignedContext,
    encode_permissions,
    sign_context,
)
from lib.db import Database
from lib.errors import AppError
from lib.idempotency import IdempotencyStore
from lib.testing import InMemoryCache
from platform_server.apps.modeling.errors import TemplateNotFound
from platform_server.apps.modeling.management_errors import (
    DeploymentRevisionConflict,
)
from platform_server.apps.modeling.models.command import ModelingCommand
from platform_server.apps.modeling.models.operator_audit import (
    ModelingOperatorAudit,
)
from platform_server.apps.modeling.schemas.management import (
    ArchiveIn,
    CursorListQuery,
    DeploymentRollbackIn,
    DeploymentSwitchIn,
)
from platform_server.apps.modeling.schemas.template import ModelingInstanceOut
from platform_server.apps.modeling.services import (
    deployment_switch as switch_operations,
)
from platform_server.apps.modeling.services import (
    management_state as archive_operations,
)
from platform_server.apps.modeling.services.command_gate import (
    DurableModelingGate,
)
from platform_server.apps.modeling.services.command_policy import (
    choose_operation,
    fingerprint,
    hash_key,
)
from platform_server.apps.modeling.services.command_service import find_command
from platform_server.apps.modeling.services.operator_audit import (
    OperatorIdentity,
)
from platform_server.apps.modeling.services.pipeline_service import Actor

COMMANDS = "/api/v1/platform/modeling-commands"


async def test_pending_http_command_returns_recovery_headers_and_envelope(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    template = await make_template(app_client)
    payload = {
        "template_id": template["id"],
        "code": "pending-http-instance",
        "name": "待核查命令",
    }
    identity = uuid.uuid4()
    key = "pending-http-command"
    db_session.add(
        ModelingCommand(
            id=identity,
            account_user_id=uuid.UUID(app_client.headers["X-Auth-User-Id"]),
            scope="modeling.create_instance",
            key_hash=hash_key(key),
            request_hash=fingerprint(
                "POST", INSTANCES, json.dumps(payload).encode(), None
            ),
            state="pending",
            trace_id="c" * 32,
        )
    )
    await db_session.flush()
    response = await app_client.post(
        INSTANCES, json=payload, headers={"Idempotency-Key": key}
    )
    assert response.status_code == 409
    assert response.json()["code"] == 41443
    assert response.json()["data"] is None
    assert len(response.json()["trace_id"]) == 32
    assert response.headers["Retry-After"] == "1"
    assert response.headers["Modeling-Command-Id"] == str(identity)
    recovered = data_of(await app_client.get(f"{COMMANDS}/{identity}"))
    assert recovered["state"] == "pending"
    assert recovered["is_verification_required"] is True


async def submit_instance(client, *, headers=None, code="recoverable"):
    template = await make_template(client)
    return await client.post(
        INSTANCES,
        json={"template_id": template["id"], "code": code, "name": "命令模型"},
        headers=headers,
    )


async def test_reusing_key_for_changed_payload_is_conflict(app_client):
    template = await make_template(app_client)
    payload = {
        "template_id": template["id"],
        "code": "command-original",
        "name": "原参数",
    }
    headers = {"Idempotency-Key": "instance-command"}
    first = await app_client.post(INSTANCES, json=payload, headers=headers)
    assert first.status_code == 201
    changed = await app_client.post(
        INSTANCES, json={**payload, "name": "另一组参数"}, headers=headers
    )
    assert changed.status_code == 409
    assert data_of(await app_client.get(INSTANCES))["total"] == 1


async def test_committed_command_is_recoverable_after_losing_response(
    app_client: httpx.AsyncClient,
):
    template = await make_template(app_client)
    headers = {"Idempotency-Key": "do-not-log-raw-key"}
    submitted = await app_client.post(
        INSTANCES,
        json={
            "template_id": template["id"],
            "code": "lost-response-instance",
            "name": "恢复模型",
        },
        headers=headers,
    )
    assert submitted.status_code == 201
    recovered = await app_client.get(
        COMMANDS, params={"operation": "create_instance"}, headers=headers
    )
    assert recovered.status_code == 200
    command = data_of(recovered)
    assert command["state"] == "succeeded"
    assert command["result"]["id"] == data_of(submitted)["id"]
    assert submitted.headers["modeling-command-id"] == command["id"]
    assert "do-not-log-raw-key" not in recovered.text


async def test_command_result_only_belongs_to_authenticated_account(
    app_client, sign
):
    headers = {"Idempotency-Key": "private-command"}
    created = await submit_instance(app_client, headers=headers)
    command_id = created.headers["modeling-command-id"]
    unrelated = sign(("modeling:view", "modeling:run"))
    by_id = await app_client.get(f"{COMMANDS}/{command_id}", headers=unrelated)
    by_key = await app_client.get(
        COMMANDS,
        params={"operation": "create_instance"},
        headers={**unrelated, **headers},
    )
    assert by_id.status_code == by_key.status_code == 404


async def test_same_account_needs_original_operation_permission(
    app_client, settings
):
    created = await submit_instance(
        app_client, headers={"Idempotency-Key": "permission-check"}
    )
    restricted = dict(app_client.headers)
    permissions = encode_permissions(("modeling:view",))
    context = SignedContext(
        user_id=restricted["x-auth-user-id"],
        role=restricted["x-auth-role"],
        permissions_b64=permissions,
        expires_at=int(restricted["x-auth-exp"]),
    )
    restricted["x-auth-permissions"] = permissions
    restricted["x-auth-sig"] = sign_context(
        settings.edge_signing_secret.get_secret_value(), context
    )
    response = await app_client.get(
        f"{COMMANDS}/{created.headers['modeling-command-id']}",
        headers=restricted,
    )
    assert response.status_code == 403


async def test_success_remains_recoverable_after_24_hours(
    app_client, db_session
):
    headers = {"Idempotency-Key": "permanent-result"}
    created = await submit_instance(app_client, headers=headers)
    command_id = uuid.UUID(created.headers["modeling-command-id"])
    row = await db_session.get(ModelingCommand, command_id)
    await db_session.execute(
        update(ModelingCommand)
        .where(ModelingCommand.id == command_id)
        .values(created_at=row.created_at - timedelta(days=2))
    )
    await db_session.commit()
    recovered = await app_client.get(f"{COMMANDS}/{command_id}")
    assert data_of(recovered)["state"] == "succeeded"
    assert data_of(recovered)["result"]["id"] == data_of(created)["id"]


class CommandProbe(BaseModel):
    value: int


def probe_gate(database, session, caller):
    return DurableModelingGate(
        idempotency=IdempotencyStore(InMemoryCache(), "test"),
        idempotency_key="missing-template",
        caller=caller,
        session=session,
        sessions=database,
        request_hash="a" * 64,
        on_command=lambda _command_id: None,
        clock=lambda: datetime(2026, 10, 30, tzinfo=UTC),
        operator=OperatorIdentity(caller.user_id, None, None),
    )


async def test_failed_command_survives_separate_request_rollback(
    app_context, settings
):
    del app_context
    database = Database(dsn=settings.dsn())
    caller = CallerContext(
        uuid.uuid4(),
        "gateway",
        "partner",
        permissions=frozenset({"modeling:view", "modeling:run"}),
    )

    async def rejected():
        raise TemplateNotFound("建模模板不存在")

    try:
        for _attempt in range(2):
            with pytest.raises(AppError) as error:
                async with database.session() as opened:
                    await probe_gate(database, opened, caller).run_once(
                        endpoint="modeling.create_instance",
                        model=CommandProbe,
                        action=rejected,
                    )
            assert error.value.http_status == 404
        async with database.session() as opened:
            recovered = await find_command(
                opened,
                caller,
                choose_operation("create_instance", None),
                "missing-template",
                datetime(2026, 10, 30, tzinfo=UTC),
            )
        assert recovered.state == "failed"
        assert recovered.error.code == 41426
    finally:
        async with database.session() as opened:
            for model in (ModelingOperatorAudit, ModelingCommand):
                await opened.execute(
                    delete(model).where(model.account_user_id == caller.user_id)
                )
        await database.dispose()


async def test_external_operator_header_is_not_an_identity_override(app_client):
    template = await make_template(app_client)
    response = await app_client.post(
        INSTANCES,
        json={
            "template_id": template["id"],
            "code": "not-trusted",
            "name": "越权",
        },
        headers={"X-Modeling-Operator-Id": "someone-else"},
    )
    assert response.status_code == 403
    assert data_of(await app_client.get(INSTANCES))["total"] == 0


async def test_replay_keeps_one_transactional_operator_audit(
    app_client, db_session
):
    template = await make_template(app_client)
    headers = {"Idempotency-Key": "audit-once"}
    payload = {
        "template_id": template["id"],
        "code": "one-audit",
        "name": "审计",
    }
    first = await app_client.post(INSTANCES, json=payload, headers=headers)
    await app_client.post(INSTANCES, json=payload, headers=headers)
    audits = list(
        (
            await db_session.scalars(
                select(ModelingOperatorAudit).where(
                    ModelingOperatorAudit.command_id
                    == uuid.UUID(first.headers["modeling-command-id"])
                )
            )
        ).all()
    )
    assert len(audits) == 1
    assert audits[0].account_user_id == uuid.UUID(
        app_client.headers["x-auth-user-id"]
    )
    assert audits[0].external_operator_id is None


async def test_trusted_gateway_audits_operator_without_replacing_account(
    app_client, db_session
):
    application = app_client._transport.app
    original = application.state.container
    account_id = uuid.UUID(app_client.headers["x-auth-user-id"])
    application.state.container = replace(
        original,
        settings=original.settings.model_copy(
            update={"modeling_trusted_operator_accounts": (account_id,)}
        ),
    )
    response = await submit_instance(
        app_client,
        headers={
            "Idempotency-Key": "trusted-operator",
            "X-Modeling-Operator-Id": "bdm-user-7",
        },
    )
    assert response.status_code == 201
    audit = await db_session.scalar(
        select(ModelingOperatorAudit).where(
            ModelingOperatorAudit.command_id
            == uuid.UUID(response.headers["modeling-command-id"])
        )
    )
    assert audit.account_user_id == account_id
    assert audit.external_operator_id == "bdm-user-7"
    assert data_of(response)["id"] == str(audit.resource_id)


async def test_legacy_cache_key_cannot_execute_another_action(app_client):
    instance = await submit_instance(app_client)
    container = app_client._transport.app.state.container
    caller_id = uuid.UUID(app_client.headers["x-auth-user-id"])

    async def previous_success():
        return ModelingInstanceOut.model_validate(data_of(instance))

    await container.idempotency.run_once(
        endpoint="modeling.create_instance",
        key="legacy-key",
        caller=caller_id,
        model=ModelingInstanceOut,
        action=previous_success,
    )
    existing = data_of(instance)
    refused = await app_client.post(
        INSTANCES,
        json={
            "template_id": existing["template_id"],
            "code": "duplicate-legacy",
            "name": "不会创建",
        },
        headers={"Idempotency-Key": "legacy-key"},
    )
    assert refused.status_code == 409
    assert refused.json()["code"] == 41444
    assert data_of(await app_client.get(INSTANCES))["total"] == 1


class UnavailableCache(InMemoryCache):
    async def get_json(self, _key):
        raise ConnectionError("cache unavailable")


async def test_legacy_result_lookup_failure_never_executes_new_action(
    app_client,
):
    template = await make_template(app_client)
    application = app_client._transport.app
    original = application.state.container
    application.state.container = replace(
        original, idempotency=IdempotencyStore(UnavailableCache(), "test")
    )
    response = await app_client.post(
        INSTANCES,
        json={
            "template_id": template["id"],
            "code": "no-cache",
            "name": "不执行",
        },
        headers={"Idempotency-Key": "never-execute"},
    )
    assert response.status_code == 503
    assert data_of(await app_client.get(INSTANCES))["total"] == 0


async def test_durable_replay_does_not_require_legacy_cache(app_client):
    template = await make_template(app_client)
    payload = {
        "template_id": template["id"],
        "code": "no-redis-replay",
        "name": "恢复",
    }
    headers = {"Idempotency-Key": "cached-in-database"}
    original = await app_client.post(INSTANCES, json=payload, headers=headers)
    application = app_client._transport.app
    application.state.container = replace(
        application.state.container,
        idempotency=IdempotencyStore(UnavailableCache(), "test"),
    )
    replay = await app_client.post(INSTANCES, json=payload, headers=headers)
    assert original.status_code == replay.status_code == 201
    assert data_of(original)["id"] == data_of(replay)["id"]


async def test_private_archive_and_restore_preserve_model_identity(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
) -> None:
    identity, versions = await seed_versions(app_client, db_session)
    actor = Actor(user_id=str(uuid.uuid4()), name="私有管理测试")
    moment = datetime(2026, 10, 30, 4, tzinfo=UTC)
    archived = await archive_operations.set_instance_archive(
        db_session,
        uuid.UUID(identity),
        ArchiveIn(expected_revision=1),
        actor,
        moment,
    )
    assert archived.archived_at == moment
    restored = await archive_operations.set_instance_archive(
        db_session,
        uuid.UUID(identity),
        ArchiveIn(expected_revision=2),
        actor,
        None,
    )
    assert restored.id == archived.id
    assert restored.archived_at is None
    version = await archive_operations.set_version_archive(
        db_session, uuid.UUID(versions[0]), actor, moment
    )
    assert version.archived_at == moment
    recovered = await archive_operations.set_version_archive(
        db_session, version.id, actor, None
    )
    assert recovered.archived_at is None


async def test_private_switch_and_rollback_preserve_service_and_history(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
) -> None:
    _, versions = await seed_versions(app_client, db_session)
    response = await app_client.post(
        "/api/v1/platform/modeling-deployments",
        json={
            "code": "private-switch",
            "name": "私有版本切换",
            "model_version_id": versions[0],
        },
    )
    identity = uuid.UUID(data_of(response)["id"])
    actor = Actor(user_id=str(uuid.uuid4()), name="私有管理测试")
    payload = DeploymentSwitchIn(
        expected_revision=1, model_version_id=versions[1]
    )
    switched = await switch_operations.switch_deployment(
        db_session, identity, payload, actor
    )
    assert switched.revision == 2
    assert switched.code == "private-switch"
    with pytest.raises(DeploymentRevisionConflict):
        await switch_operations.switch_deployment(
            db_session, identity, payload, actor
        )
    history = await switch_operations.list_switches(
        db_session, identity, CursorListQuery()
    )
    assert len(history.items) == 1
    rolled_back = await switch_operations.rollback_deployment(
        db_session,
        identity,
        DeploymentRollbackIn(
            expected_revision=2, switch_id=history.items[0].id
        ),
        actor,
    )
    assert str(rolled_back.model_version_id) == versions[0]
    assert rolled_back.revision == 3


async def test_duplicate_operator_headers_are_rejected_before_execution(
    app_client: httpx.AsyncClient,
) -> None:
    template = await make_template(app_client)
    response = await app_client.post(
        INSTANCES,
        json={
            "template_id": template["id"],
            "code": "duplicate-operator",
            "name": "不应创建",
        },
        headers=[
            ("X-Modeling-Operator-Id", "first"),
            ("X-Modeling-Operator-Id", "second"),
        ],
    )
    assert response.status_code == 400
    assert response.json()["code"] == 40001


@pytest.mark.parametrize("operation", ["retire_version", "delete_deployment"])
def test_delete_command_receipts_preserve_http_no_content(
    operation: Literal["retire_version", "delete_deployment"],
) -> None:
    assert choose_operation(operation, uuid.uuid4()).http_status == 204
