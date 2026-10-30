"""独立 PostgreSQL 事务中的命令回执、回滚与并发恢复。"""

import asyncio
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

import pytest
from conftest import AppContext
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from integration.modeling_helpers import data_of
from integration.modeling_management_helpers import (
    seed_rule_versions,
    seed_versions,
)
from lib.auth import CallerContext
from lib.db import Database
from lib.errors import DependencyUnavailable
from lib.idempotency import IdempotencyStore
from lib.testing import InMemoryCache
from platform_server.apps.modeling.command_errors import CommandPending
from platform_server.apps.modeling.errors import (
    InstanceNotFound,
    InstanceRevisionConflict,
    ModelVersionNotFound,
    ModelVersionUnservable,
)
from platform_server.apps.modeling.management_errors import (
    DeploymentSignatureChanged,
    DeploymentVersionMismatch,
    ModelingResourceInUse,
)
from platform_server.apps.modeling.models import (
    ModelingCommand,
    ModelingModelVersion,
    ModelingOperatorAudit,
    ModelingPipeline,
)
from platform_server.apps.modeling.schemas.management import (
    ArchiveIn,
    DeploymentSwitchIn,
)
from platform_server.apps.modeling.services import (
    deployment_switch as switch_operations,
)
from platform_server.apps.modeling.services import (
    management_state as archive_operations,
)
from platform_server.apps.modeling.services.command_gate import (
    DurableModelingGate,
)
from platform_server.apps.modeling.services.command_service import get_command
from platform_server.apps.modeling.services.operator_audit import (
    OperatorIdentity,
)
from platform_server.apps.modeling.services.pipeline_service import Actor
from platform_server.settings import Settings

NOW = datetime(2026, 10, 30, 3, tzinfo=UTC)
OPERATION = "modeling.create_instance"


class Receipt(BaseModel):
    id: uuid.UUID


@dataclass
class CommittedCommands:
    database: Database
    account: uuid.UUID = field(default_factory=uuid.uuid4)
    pipelines: list[uuid.UUID] = field(default_factory=list)

    def gate(self, session: AsyncSession) -> DurableModelingGate:
        return DurableModelingGate(
            idempotency=IdempotencyStore(
                cache=InMemoryCache(), namespace="command-transaction-test"
            ),
            idempotency_key="independent-transaction",
            caller=CallerContext(
                user_id=self.account,
                username="事务验收账号",
                role="tester",
                permissions=frozenset({"modeling:view", "modeling:run"}),
            ),
            session=session,
            sessions=self.database,
            request_hash="a" * 64,
            on_command=lambda _identity: None,
            clock=lambda: NOW,
            operator=OperatorIdentity(self.account, None, None),
        )

    async def create(self, session: AsyncSession) -> Receipt:
        identity = uuid.uuid4()
        self.pipelines.append(identity)
        session.add(
            ModelingPipeline(
                id=identity,
                code=f"transaction-{identity.hex}",
                name="独立事务验收",
                graph_json={"format_version": "1.0", "nodes": [], "edges": []},
            )
        )
        await session.flush()
        return Receipt(id=identity)


@pytest.fixture
async def committed_commands(
    settings: Settings, app_context: AppContext
) -> AsyncIterator[CommittedCommands]:
    del app_context
    database = Database(
        dsn=settings.dsn(), search_path=settings.postgres_schema
    )
    fixture = CommittedCommands(database)
    try:
        yield fixture
    finally:
        async with database.session() as session:
            await session.execute(
                delete(ModelingOperatorAudit).where(
                    ModelingOperatorAudit.account_user_id == fixture.account
                )
            )
            await session.execute(
                delete(ModelingCommand).where(
                    ModelingCommand.account_user_id == fixture.account
                )
            )
            await session.execute(
                delete(ModelingPipeline).where(
                    ModelingPipeline.id.in_(fixture.pipelines)
                )
            )
        await database.dispose()


async def _must_not_execute() -> Receipt:
    raise AssertionError("原命令不得重新执行")


async def _write_then_interrupt(fixture: CommittedCommands) -> None:
    async with fixture.database.session() as session:
        await fixture.gate(session).run_once(
            endpoint=OPERATION,
            model=Receipt,
            action=lambda: fixture.create(session),
        )
        raise RuntimeError("提交前中断")


async def test_success_survives_lost_response_and_new_connection(
    committed_commands: CommittedCommands,
) -> None:
    fixture = committed_commands
    async with fixture.database.session() as session:
        first = await fixture.gate(session).run_once(
            endpoint=OPERATION,
            model=Receipt,
            action=lambda: fixture.create(session),
        )
    async with fixture.database.session() as session:
        replay = await fixture.gate(session).run_once(
            endpoint=OPERATION, model=Receipt, action=_must_not_execute
        )
        stored = await session.get(ModelingPipeline, first.id)
        assert replay.id == first.id
        assert stored is not None


async def test_outer_rollback_keeps_unknown_command_without_business_write(
    committed_commands: CommittedCommands,
) -> None:
    fixture = committed_commands
    with pytest.raises(RuntimeError, match="提交前中断"):
        await _write_then_interrupt(fixture)
    async with fixture.database.session() as session:
        command = await session.scalar(
            select(ModelingCommand).where(
                ModelingCommand.account_user_id == fixture.account
            )
        )
        assert command is not None
        assert command.state == "pending"
        assert command.result_json is None
        shown = await get_command(
            session,
            fixture.gate(session).caller,
            command.id,
            command.created_at + timedelta(minutes=6),
        )
        assert shown.state == "unknown"
        assert shown.is_verification_required is True
        await session.refresh(command)
        assert command.state == "pending"
        assert await session.get(ModelingPipeline, fixture.pipelines[0]) is None
        with pytest.raises(CommandPending):
            await fixture.gate(session).run_once(
                endpoint=OPERATION, model=Receipt, action=_must_not_execute
            )


async def test_concurrent_duplicate_cannot_run_while_original_is_uncommitted(
    committed_commands: CommittedCommands,
) -> None:
    fixture = committed_commands
    entered = asyncio.Event()
    release = asyncio.Event()

    async def original() -> Receipt:
        async with fixture.database.session() as session:

            async def held_action() -> Receipt:
                receipt = await fixture.create(session)
                entered.set()
                await release.wait()
                return receipt

            return await fixture.gate(session).run_once(
                endpoint=OPERATION, model=Receipt, action=held_action
            )

    task = asyncio.create_task(original())
    try:
        async with asyncio.timeout(10):
            await entered.wait()
            async with fixture.database.session() as session:
                with pytest.raises(CommandPending):
                    await fixture.gate(session).run_once(
                        endpoint=OPERATION,
                        model=Receipt,
                        action=_must_not_execute,
                    )
            release.set()
            receipt = await task
        assert receipt.id == fixture.pipelines[0]
        assert len(fixture.pipelines) == 1
    finally:
        release.set()
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)


async def test_dependency_failure_leaves_unknown_command_without_business_data(
    committed_commands: CommittedCommands,
) -> None:
    fixture = committed_commands
    with pytest.raises(DependencyUnavailable):
        await _write_then_fail_dependency(fixture)
    async with fixture.database.session() as session:
        command = await session.scalar(
            select(ModelingCommand).where(
                ModelingCommand.account_user_id == fixture.account
            )
        )
        assert command is not None
        assert command.state == "pending"
        assert command.error_json is None
        assert await session.get(ModelingPipeline, fixture.pipelines[0]) is None
        shown = await get_command(
            session,
            fixture.gate(session).caller,
            command.id,
            command.created_at + timedelta(minutes=6),
        )
        assert shown.state == "unknown"
        with pytest.raises(CommandPending):
            await fixture.gate(session).run_once(
                endpoint=OPERATION, model=Receipt, action=_must_not_execute
            )


async def test_private_archive_rejects_stale_missing_and_referenced_resources(
    app_client,
    db_session,
) -> None:
    identity, versions = await seed_versions(app_client, db_session)
    actor = Actor(user_id=str(uuid.uuid4()), name="归档边界测试")
    instant = datetime(2026, 10, 30, tzinfo=UTC)
    restored = await archive_operations.set_instance_archive(
        db_session, uuid.UUID(identity), ArchiveIn(), actor, None
    )
    assert restored.revision == 1
    with pytest.raises(InstanceRevisionConflict):
        await archive_operations.set_instance_archive(
            db_session,
            restored.id,
            ArchiveIn(expected_revision=99),
            actor,
            instant,
        )
    with pytest.raises(InstanceNotFound):
        await archive_operations.set_instance_archive(
            db_session, uuid.uuid4(), ArchiveIn(), actor, instant
        )
    active = await archive_operations.set_version_archive(
        db_session, uuid.UUID(versions[0]), actor, None
    )
    assert active.archived_at is None
    with pytest.raises(ModelVersionNotFound):
        await archive_operations.set_version_archive(
            db_session, uuid.uuid4(), actor, instant
        )
    created = await app_client.post(
        "/api/v1/platform/modeling-deployments",
        json={
            "code": "archive-in-use",
            "name": "引用保护",
            "model_version_id": versions[0],
        },
    )
    assert created.status_code == 201
    with pytest.raises(ModelingResourceInUse):
        await archive_operations.set_instance_archive(
            db_session, restored.id, ArchiveIn(), actor, instant
        )
    with pytest.raises(ModelingResourceInUse):
        await archive_operations.set_version_archive(
            db_session, active.id, actor, instant
        )


async def test_private_switch_rejects_unservable_and_wrong_task_targets(
    app_client,
    db_session,
) -> None:
    identity, versions = await seed_versions(app_client, db_session)
    actor = Actor(user_id=str(uuid.uuid4()), name="切换边界测试")
    created = data_of(
        await app_client.post(
            "/api/v1/platform/modeling-deployments",
            json={
                "code": "switch-edge",
                "name": "切换保护",
                "model_version_id": versions[0],
            },
        )
    )
    deployment_id = uuid.UUID(created["id"])
    same = await switch_operations.switch_deployment(
        db_session,
        deployment_id,
        DeploymentSwitchIn(expected_revision=1, model_version_id=versions[0]),
        actor,
    )
    assert same.revision == 1
    target = await db_session.get(ModelingModelVersion, uuid.UUID(versions[1]))
    assert target is not None
    target.servable, target.unservable_reason = False, "未通过评估"
    await db_session.commit()
    with pytest.raises(ModelVersionUnservable):
        await switch_operations.switch_deployment(
            db_session,
            deployment_id,
            DeploymentSwitchIn(expected_revision=1, model_version_id=target.id),
            actor,
        )
    rules = await seed_rule_versions(db_session, identity)
    with pytest.raises(DeploymentVersionMismatch):
        await switch_operations.switch_deployment(
            db_session,
            deployment_id,
            DeploymentSwitchIn(expected_revision=1, model_version_id=rules[0]),
            actor,
        )


async def test_private_rule_kind_switch_requires_explicit_contract_confirmation(
    app_client,
    db_session,
) -> None:
    identity, _ = await seed_versions(app_client, db_session)
    rules = await seed_rule_versions(db_session, identity)
    actor = Actor(user_id=str(uuid.uuid4()), name="规则契约测试")
    created = data_of(
        await app_client.post(
            "/api/v1/platform/modeling-deployments",
            json={
                "code": "rule-switch-edge",
                "name": "规则切换",
                "model_version_id": rules[0],
            },
        )
    )
    deployment_id = uuid.UUID(created["id"])
    command = DeploymentSwitchIn(expected_revision=1, model_version_id=rules[1])
    with pytest.raises(DeploymentSignatureChanged):
        await switch_operations.switch_deployment(
            db_session, deployment_id, command, actor
        )
    confirmed = await switch_operations.switch_deployment(
        db_session,
        deployment_id,
        command.model_copy(update={"is_signature_change_confirmed": True}),
        actor,
    )
    assert str(confirmed.model_version_id) == rules[1]


async def _write_then_fail_dependency(fixture: CommittedCommands) -> None:
    async with fixture.database.session() as session:

        async def fail_after_write() -> Receipt:
            await fixture.create(session)
            raise DependencyUnavailable("下游暂时不可用")

        await fixture.gate(session).run_once(
            endpoint=OPERATION, model=Receipt, action=fail_after_write
        )
