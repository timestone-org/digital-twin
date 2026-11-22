"""工作流和旧实例命令保留同一预约槽及各自真实调用身份。"""

import uuid
from dataclasses import replace
from datetime import timedelta

import httpx
import pytest
from conftest import AppContext
from fastapi import FastAPI
from sqlalchemy import func, select
from unit.source_fakes import InMemoryStream

from integration.modeling_helpers import create_pipeline, data_of, linear_graph
from integration.test_modeling_command_transactions import (
    CommittedCommands,
    Receipt,
    committed_commands,
)
from integration.test_modeling_templates import make_instance
from lib.utils.ids import uuid7
from lib.utils.timeutils import utcnow
from platform_server.apps.modeling.errors import RunAlreadyActive
from platform_server.apps.modeling.models import ModelingCommand, ModelingRun
from platform_server.apps.modeling.models.operator_audit import (
    ModelingOperatorAudit,
)
from platform_server.apps.modeling.services.command_policy import (
    fingerprint,
    hash_key,
)

__all__ = ["committed_commands"]

pytestmark = pytest.mark.requires_postgres
BASE = "/api/v1/platform"
COMMANDS = BASE + "/modeling-commands"


@pytest.fixture(autouse=True)
def record_training_stream(
    app_context: AppContext, stream: InMemoryStream
) -> None:
    """用当前用例的流替身记录真实提交后的训练消息。"""
    transport = app_context.client._transport
    assert isinstance(transport, httpx.ASGITransport)
    assert isinstance(transport.app, FastAPI)
    application = transport.app
    application.state.container = replace(
        application.state.container, stream=stream
    )


async def training_entry(
    client: httpx.AsyncClient, is_instance: bool
) -> tuple[str, str, str]:
    resource = (
        await make_instance(client)
        if is_instance
        else await create_pipeline(
            client, "command-training", linear_graph("qa_source")
        )
    )
    identifier = str(resource["id"])
    route = (
        f"{BASE}/modeling-instances/{identifier}:train"
        if is_instance
        else f"{BASE}/modeling-pipelines/{identifier}:run"
    )
    name = "train_instance" if is_instance else "run_pipeline"
    return identifier, route, name


async def verify_persistence(
    app_context: AppContext, key: str, identifier: str, name: str, run_id: str
) -> None:
    """核对稳定预约和训练审计。

    Args: app_context, key, identifier, name, run_id。
    """
    record = await app_context.session.get(ModelingCommand, uuid.UUID(key))
    assert record is not None
    assert record.scope == f"modeling.train_instance.{identifier}"
    audited = await app_context.session.scalar(
        select(ModelingOperatorAudit).where(
            ModelingOperatorAudit.command_id == record.id
        )
    )
    assert audited is not None
    assert (audited.operation, audited.resource_id, audited.http_status) == (
        name,
        uuid.UUID(run_id),
        202,
    )


@pytest.mark.parametrize("is_instance", [False, True])
async def test_new_command_records_the_entry_and_keeps_one_physical_key(
    app_context: AppContext, stream: InMemoryStream, is_instance: bool
) -> None:
    client = app_context.client
    identifier, route, name = await training_entry(client, is_instance)
    headers = {"Idempotency-Key": "same-local-key"}
    first = await client.post(
        route, json={"trigger": "manual"}, headers=headers
    )
    assert first.status_code == 202, first.text
    key = first.headers["Modeling-Command-Id"]
    replay = await client.post(
        route, json={"trigger": "manual"}, headers=headers
    )
    assert replay.status_code == 202
    assert replay.headers["Modeling-Command-Id"] == key
    assert data_of(replay)["id"] == data_of(first)["id"]
    detail = await client.get(f"{COMMANDS}/{key}")
    assert data_of(detail)["operation"] == name
    found = await client.get(
        COMMANDS,
        params={"operation": name, "resource_id": identifier},
        headers=headers,
    )
    assert found.status_code == 200, found.text
    assert data_of(found)["id"] == key
    await verify_persistence(
        app_context, key, identifier, name, str(data_of(first)["id"])
    )
    assert (
        sum(
            entry.fields.get("run_id") == data_of(first)["id"]
            for entry in stream.entries
        )
        == 1
    )
    if is_instance:
        other = await client.post(
            f"{BASE}/modeling-pipelines/{identifier}:run",
            json={"trigger": "manual"},
            headers=headers,
        )
        assert other.status_code == 409
        assert other.json()["code"] == 41442


async def test_unknown_legacy_command_remains_visible_without_starting_a_run(
    app_context: AppContext, stream: InMemoryStream
) -> None:
    client = app_context.client
    pipeline = await create_pipeline(
        client, "old-command", linear_graph("qa_source")
    )
    identifier = str(pipeline["id"])
    route = f"{BASE}/modeling-pipelines/{identifier}:run"
    key = "legacy-pending"
    headers = {"Idempotency-Key": key}
    candidate = ModelingCommand(
        id=uuid7(),
        account_user_id=uuid.UUID(client.headers["X-Auth-User-Id"]),
        scope=f"modeling.train_instance.{identifier}",
        key_hash=hash_key(key),
        request_hash=fingerprint("POST", route, b'{"trigger":"manual"}', None),
        state="pending",
        trace_id="",
        created_at=utcnow() - timedelta(hours=1),
    )
    app_context.session.add(candidate)
    await app_context.session.commit()
    for operation in ["train_instance", "run_pipeline"]:
        found = await client.get(
            COMMANDS,
            params={"operation": operation, "resource_id": identifier},
            headers=headers,
        )
        assert found.status_code == 200, found.text
        assert data_of(found)["id"] == str(candidate.id)
        assert data_of(found)["state"] == "unknown"
    replay = await client.post(
        route, json={"trigger": "manual"}, headers=headers
    )
    assert replay.status_code == 409
    assert replay.headers["Modeling-Command-Id"] == str(candidate.id)
    assert (
        await app_context.session.scalar(
            select(func.count())
            .select_from(ModelingRun)
            .where(ModelingRun.pipeline_id == uuid.UUID(identifier))
        )
        == 0
    )
    assert not any("run_id" in entry.fields for entry in stream.entries)


async def test_original_success_and_original_lookup_keep_their_identity(
    app_context: AppContext, stream: InMemoryStream
) -> None:
    client = app_context.client
    identifier, route, _ = await training_entry(client, False)
    headers = {"Idempotency-Key": "old-writer"}
    first = await client.post(route, json={}, headers=headers)
    assert first.status_code == 202
    identity = uuid.UUID(first.headers["Modeling-Command-Id"])
    stored = await app_context.session.get(ModelingCommand, identity)
    assert stored is not None
    stored.requested_operation = None
    await app_context.session.commit()
    original = await client.get(f"{COMMANDS}/{identity}")
    assert data_of(original)["operation"] == "train_instance"
    for selector in ("run_pipeline", "train_instance"):
        lookup = await client.get(
            COMMANDS,
            params={"operation": selector, "resource_id": identifier},
            headers=headers,
        )
        assert data_of(lookup)["id"] == str(identity)
        assert data_of(lookup)["operation"] == "train_instance"
    replay = await client.post(route, json={}, headers=headers)
    assert replay.status_code == 202
    assert replay.headers["Modeling-Command-Id"] == str(identity)
    assert (
        sum(
            e.fields.get("run_id") == data_of(first)["id"]
            for e in stream.entries
        )
        == 1
    )


async def test_rejected_workflow_training_keeps_its_operation_in_the_audit(
    committed_commands: CommittedCommands,
) -> None:
    fixture = committed_commands
    resource = uuid.uuid4()

    async def busy() -> Receipt:
        raise RunAlreadyActive("合成工作流已有运行")

    with pytest.raises(RunAlreadyActive):
        async with fixture.database.session() as opened:
            await fixture.gate(opened).run_once(
                endpoint=f"modeling.run_pipeline.{resource}",
                model=Receipt,
                action=busy,
            )
    async with fixture.database.session() as read:
        stored = await read.scalar(
            select(ModelingCommand).where(
                ModelingCommand.account_user_id == fixture.account
            )
        )
        assert stored is not None
        assert stored.state == "failed"
        assert stored.requested_operation == "run_pipeline"
        audit = await read.scalar(
            select(ModelingOperatorAudit).where(
                ModelingOperatorAudit.command_id == stored.id
            )
        )
        assert audit is not None
        assert (audit.operation, audit.resource_id, audit.http_status) == (
            "run_pipeline",
            resource,
            409,
        )
