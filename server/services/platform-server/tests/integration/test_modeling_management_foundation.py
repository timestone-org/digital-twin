"""模型管理基础结构的真实引用、归档锁和命令唯一身份。"""

import uuid
from datetime import UTC, datetime

import httpx
import pytest
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from integration.modeling_management_helpers import seed_versions
from lib.utils.ids import uuid7
from platform_server.apps.modeling.crud import command, management_state
from platform_server.apps.modeling.errors import ModelVersionNotFound
from platform_server.apps.modeling.management_errors import ModelingArchived
from platform_server.apps.modeling.models import (
    ModelingCommand,
    ModelingDeployment,
    ModelingDeploymentSwitch,
    ModelingInstance,
    ModelingRun,
)
from platform_server.apps.modeling.schemas.command import (
    CommandFailureOut,
    CommandResourceOut,
    ModelingCommandOut,
)
from platform_server.apps.modeling.schemas.management import (
    CursorListQuery,
    DeploymentListQuery,
    HistoryListQuery,
    ManagementListQuery,
)
from platform_server.apps.modeling.services.management_guard import (
    require_active_instance,
    require_active_version,
)

NOW = datetime(2026, 10, 30, tzinfo=UTC)
MISSING = uuid.UUID("01900000-0000-7000-8000-000000000001")


async def test_foundation_guard_rejects_archived_instance_and_missing_version(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    identity, versions = await seed_versions(app_client, db_session)
    instance = await db_session.get(ModelingInstance, uuid.UUID(identity))
    assert instance is not None
    instance.archived_at = NOW
    await db_session.commit()
    with pytest.raises(ModelingArchived):
        await require_active_instance(db_session, instance.id)
    instance.archived_at = None
    await db_session.commit()
    active = await require_active_version(db_session, uuid.UUID(versions[0]))
    assert str(active.id) == versions[0]
    active.archived_at = NOW
    await db_session.commit()
    with pytest.raises(ModelingArchived):
        await require_active_version(db_session, active.id)
    with pytest.raises(ModelVersionNotFound):
        await require_active_version(db_session, MISSING)


async def test_foundation_references_include_deployment_run_and_switch_history(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    identity, versions = await seed_versions(app_client, db_session)
    first, second = (uuid.UUID(value) for value in versions)
    assert (
        await management_state.instance_references(
            db_session, uuid.UUID(identity)
        )
        == 0
    )
    deployment = ModelingDeployment(
        code="foundation-service", name="基础服务", model_version_id=first
    )
    db_session.add(deployment)
    db_session.add(
        ModelingRun(
            pipeline_id=uuid.UUID(identity),
            status="pending",
            trigger="api",
            graph_snapshot={},
        )
    )
    await db_session.flush()
    history = ModelingDeploymentSwitch(
        deployment_id=deployment.id,
        deployment_code=deployment.code,
        from_model_id=first,
        to_model_id=second,
        revision=2,
        is_signature_change_confirmed=False,
        created_by_name="测试",
    )
    db_session.add(history)
    await db_session.flush()
    assert history.from_version_id == first
    assert history.to_version_id == second
    assert await management_state.version_references(db_session, first) == 1
    assert (
        await management_state.instance_references(
            db_session, uuid.UUID(identity)
        )
        == 2
    )
    assert (
        await management_state.version_history_references(db_session, second)
        == 1
    )
    assert await management_state.lock_version(db_session, MISSING) is None
    assert await management_state.lock_instance(db_session, MISSING) is None


async def test_foundation_command_has_unique_identity_and_atomic_receipt(
    db_session: AsyncSession,
) -> None:
    account = uuid7()
    candidate = ModelingCommand(
        id=uuid7(),
        account_user_id=account,
        scope="modeling.create_instance",
        key_hash="a" * 64,
        request_hash="b" * 64,
        state="pending",
        trace_id="c" * 32,
    )
    first, owner = await command.reserve(db_session, candidate)
    replay, duplicate_owner = await command.reserve(db_session, candidate)
    assert owner is True
    assert duplicate_owner is False
    assert replay.id == first.id
    await command.complete(
        db_session,
        command.CommandCompletion(first.id, 201, {"id": "resource"}, NOW),
    )
    found = await command.find(
        db_session,
        command.CommandIdentity(account, candidate.scope, candidate.key_hash),
    )
    assert found is not None
    await db_session.refresh(found)
    assert found.state == "succeeded"
    assert found.result_json == {"id": "resource"}
    assert await command.get(db_session, MISSING, found.id) is None
    assert await command.get(db_session, account, MISSING) is None


@pytest.mark.parametrize(
    "query",
    [
        {"pagination": "page", "after": "cursor"},
        {"limit": 201},
        {"size": 0},
        {
            "instance_id": str(MISSING),
            "pipeline_id": "01900000-0000-7000-8000-000000000002",
        },
        {"created_at__gte": "2026-01-01T00:00:00"},
        {
            "created_at__gte": "2027-01-01T00:00:00Z",
            "created_at__lt": "2026-01-01T00:00:00Z",
        },
    ],
    ids=["cursor-mode", "limit", "size", "identity", "timezone", "range"],
)
def test_foundation_queries_reject_ambiguous_boundaries(query: dict) -> None:
    with pytest.raises(ValidationError):
        HistoryListQuery.model_validate(query)


def test_foundation_query_defaults_keep_legacy_page_size() -> None:
    query = ManagementListQuery()
    assert (query.pagination, query.page, query.size) == ("page", 1, 20)


def command_output(row: ModelingCommand) -> ModelingCommandOut:
    return ModelingCommandOut(
        id=row.id,
        operation="create_instance",
        resource_id=None,
        state=row.state,
        http_status=row.http_status,
        result=row.result_json,
        error=(
            CommandFailureOut.model_validate(row.error_json)
            if row.error_json is not None
            else None
        ),
        created_at=row.created_at,
        completed_at=row.completed_at,
        trace_id=row.trace_id,
        is_verification_required=False,
    )


@pytest.mark.parametrize(
    "is_failure", [False, True], ids=["success", "rejection"]
)
async def test_command_receipt_keeps_public_result_and_error_contract(
    db_session: AsyncSession, is_failure: bool
) -> None:
    account, resource, identity = uuid7(), uuid7(), uuid7()
    row, _owner = await command.reserve(
        db_session,
        ModelingCommand(
            id=identity,
            account_user_id=account,
            scope="modeling.create_instance",
            key_hash="d" * 64,
            request_hash="e" * 64,
            state="pending",
            trace_id="f" * 32,
        ),
    )
    failure = CommandFailureOut.model_validate(
        {
            "code": 41442,
            "message": "命令参数冲突",
            "details": [
                {
                    "field": "configuration.nodes.source",
                    "code": "conflict",
                    "message": "参数已改变",
                }
            ],
        }
    )
    receipt = CommandResourceOut(id=resource)
    stored = (
        failure.model_dump(mode="json")
        if is_failure
        else receipt.model_dump(mode="json")
    )
    await command.complete(
        db_session,
        command.CommandCompletion(
            identity, 409 if is_failure else 201, stored, NOW, is_failure
        ),
    )
    await db_session.refresh(row)
    public = command_output(row).model_dump(mode="json")
    assert public["state"] == ("failed" if is_failure else "succeeded")
    assert public["result"] == (None if is_failure else {"id": str(resource)})
    assert public["error"] == (
        failure.model_dump(mode="json") if is_failure else None
    )
    assert public["trace_id"] == "f" * 32
    assert not {"account_user_id", "key_hash", "request_hash"} & public.keys()


@pytest.mark.parametrize(
    ("field", "value"),
    [("state", "cancelled"), ("operation", "predict")],
    ids=["run-state-is-not-command-state", "inference-is-not-management"],
)
def test_command_wire_rejects_runtime_values_from_a_different_resource(
    field: str, value: str
) -> None:
    payload = {
        "id": str(MISSING),
        "operation": "train_instance",
        "resource_id": str(MISSING),
        "state": "pending",
        "http_status": None,
        "result": None,
        "error": None,
        "created_at": NOW,
        "completed_at": None,
        "trace_id": "a" * 32,
        "is_verification_required": True,
    }
    payload[field] = value
    with pytest.raises(ValidationError) as rejected:
        ModelingCommandOut.model_validate(payload)
    assert [item["loc"] for item in rejected.value.errors()] == [(field,)]


def test_cursor_only_history_does_not_accept_legacy_page_mode() -> None:
    assert CursorListQuery().pagination == "cursor"
    with pytest.raises(ValidationError, match="此集合只支持游标分页"):
        CursorListQuery(pagination="page")


def test_history_same_instance_identity_preserves_explicit_utc_bounds() -> None:
    query = HistoryListQuery.model_validate(
        {
            "instance_id": str(MISSING),
            "pipeline_id": str(MISSING),
            "created_at__gte": "2026-10-01T00:00:00Z",
            "created_at__lt": "2026-11-01T00:00:00Z",
        }
    )
    assert query.instance_id == query.pipeline_id == MISSING
    assert query.created_since == datetime(2026, 10, 1, tzinfo=UTC)
    assert query.created_until == datetime(2026, 11, 1, tzinfo=UTC)


@pytest.mark.parametrize("code", ["has spaces", "/service", ""])
def test_deployment_filter_requires_the_actual_service_code(code: str) -> None:
    with pytest.raises(ValidationError):
        DeploymentListQuery(code=code)
