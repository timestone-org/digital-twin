"""旧幂等回执补齐模型类型，保留首次身份、元数据与部署版本。"""

import json
import uuid

import httpx
import pytest
from conftest import AppContext
from pydantic import JsonValue, TypeAdapter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from integration.test_modeling_instance_lifecycle import DEPLOYMENTS
from integration.test_modeling_templates import (
    INSTANCES,
    TEMPLATES,
    make_instance,
    make_template,
)
from lib.testing import InMemoryCache
from lib.utils.ids import uuid7
from platform_server.apps.modeling.models import (
    ModelingModelVersion,
    ModelingRuleVersion,
    ModelingRun,
)
from platform_server.apps.modeling.models.command import ModelingCommand
from platform_server.apps.modeling.models.operator_audit import (
    ModelingOperatorAudit,
)
from platform_server.apps.modeling.services.task_replay import TaskReceipt

_OBJECT = TypeAdapter(dict[str, JsonValue])
_OBJECTS = TypeAdapter(list[dict[str, JsonValue]])


def data_of(response: httpx.Response) -> dict[str, JsonValue]:
    """读取对象型统一信封；Args: response。"""
    body = _OBJECT.validate_json(response.content)
    return _OBJECT.validate_python(body["data"])


def _list_of(response: httpx.Response) -> list[dict[str, JsonValue]]:
    """读取列表型统一信封；Args: response。"""
    body = _OBJECT.validate_json(response.content)
    return _OBJECTS.validate_python(body["data"])


def _identity(payload: dict[str, JsonValue], key: str = "id") -> str:
    """读取响应中的字符串身份；Args: payload, key。"""
    value = payload[key]
    assert isinstance(value, str)
    return value


def _remove_cached_task(context: AppContext, resource_id: str) -> None:
    cache = context.idempotency.cache
    assert isinstance(cache, InMemoryCache)
    results = [
        (key, _OBJECT.validate_json(raw))
        for key, raw in cache.store.items()
        if ":idem:result:" in key
    ]
    matching = [
        (key, value) for key, value in results if value.get("id") == resource_id
    ]
    assert len(matching) == 1
    key, value = matching[0]
    del value["task"]
    cache.store[key] = json.dumps(value)


async def _remove_durable_task(
    context: AppContext, response: httpx.Response
) -> None:
    identity = uuid.UUID(response.headers["Modeling-Command-Id"])
    row = await context.session.get(ModelingCommand, identity)
    assert row is not None
    assert row.result_json is not None
    payload = dict(row.result_json)
    del payload["task"]
    row.result_json = payload
    await context.session.flush()


async def _version(
    session: AsyncSession, pipeline_id: str, task: str, version: int
) -> str:
    run_id = uuid7()
    session.add(
        ModelingRun(
            id=run_id,
            pipeline_id=uuid.UUID(pipeline_id),
            status="succeeded",
            trigger="manual",
            graph_snapshot={},
        )
    )
    await session.flush()
    is_rule = task == "rule_calculation"
    model = ModelingRuleVersion if is_rule else ModelingModelVersion
    row = model(
        id=uuid7(),
        pipeline_id=uuid.UUID(pipeline_id),
        run_id=run_id,
        name="能源模型",
        servable=True,
        serving_channel="json",
        serving_json={},
        signature_json={},
        feature_keys=["输入"],
        metrics_json={},
        fingerprint_json={},
        version=version,
        algo="energy_rules" if is_rule else "linear_regression",
        task=task,
        target_key=None if is_rule else "目标",
    )
    session.add(row)
    await session.flush()
    return str(row.id)


async def test_old_template_receipt_keeps_first_metadata(
    app_context: AppContext,
) -> None:
    client = app_context.client
    source = await make_template(client)
    payload = {"pipeline_id": source["pipeline_id"], "name": "冻结模板回执"}
    headers = {"Idempotency-Key": "old-template-receipt"}
    first = await client.post(TEMPLATES, json=payload, headers=headers)
    assert first.status_code == 201
    saved = data_of(first)
    _remove_cached_task(app_context, _identity(saved))
    disabled = await client.patch(
        f"{TEMPLATES}/{saved['id']}", json={"is_enabled": False}
    )
    assert disabled.status_code == 200
    replay = await client.post(TEMPLATES, json=payload, headers=headers)
    assert replay.status_code == 201, replay.text
    assert data_of(replay) == saved
    assert replay.headers["location"] == first.headers["location"]
    assert data_of(await client.get(TEMPLATES))["total"] == 2


async def test_old_instance_receipt_keeps_first_revision_and_name(
    app_context: AppContext,
) -> None:
    client = app_context.client
    template = await make_template(client)
    payload = {
        "template_id": template["id"],
        "code": "old-instance",
        "name": "首次名称",
    }
    headers = {"Idempotency-Key": "old-instance-receipt"}
    first = await client.post(INSTANCES, json=payload, headers=headers)
    assert first.status_code == 201
    saved = data_of(first)
    await _remove_durable_task(app_context, first)
    url = f"{INSTANCES}/{saved['id']}/configuration"
    configuration = data_of(await client.get(url))["configuration"]
    changed = await client.put(
        url,
        json={
            "expected_revision": 1,
            "configuration": configuration,
            "name": "新名称",
        },
    )
    assert changed.status_code == 200
    assert data_of(changed)["revision"] == 2
    replay = await client.post(INSTANCES, json=payload, headers=headers)
    assert replay.status_code == 201, replay.text
    assert data_of(replay) == saved
    assert replay.headers["location"] == first.headers["location"]
    assert data_of(await client.get(INSTANCES))["total"] == 1


@pytest.mark.parametrize(
    "should_retire_original", [False, True], ids=["retained", "retired"]
)
async def test_old_deployment_receipt_uses_its_original_version_task(
    app_context: AppContext,
    should_retire_original: bool,
) -> None:
    client = app_context.client
    instance = await make_instance(client)
    original = await _version(
        app_context.session, _identity(instance), "regression", 1
    )
    replacement = await _version(
        app_context.session, _identity(instance), "rule_calculation", 2
    )
    payload = {
        "model_version_id": original,
        "code": "old-deployment",
        "name": "首次部署",
    }
    url = f"{INSTANCES}/{instance['id']}:deploy"
    headers = {"Idempotency-Key": "old-deployment-receipt"}
    first = await client.post(url, json=payload, headers=headers)
    assert first.status_code == 201, first.text
    saved = data_of(first)
    await _remove_durable_task(app_context, first)
    switched = await client.patch(
        f"{DEPLOYMENTS}/{saved['id']}",
        json={"model_version_id": replacement, "name": "已切换规则版本"},
    )
    assert switched.status_code == 200, switched.text
    assert data_of(switched)["task"] == "rule_calculation"
    if should_retire_original:
        retired = await client.delete(
            f"/api/v1/platform/modeling-model-versions/{original}"
        )
        assert retired.status_code == 204, retired.text
    replay = await client.post(url, json=payload, headers=headers)
    if should_retire_original:
        assert replay.status_code == 404, replay.text
    else:
        assert replay.status_code == 201, replay.text
        assert data_of(replay) == saved
        assert data_of(replay)["task"] == "regression"
        assert replay.headers["location"] == first.headers["location"]
    current = _list_of(await client.get(DEPLOYMENTS))
    assert len(current) == 1
    assert current[0]["model_version_id"] == replacement
    assert current[0]["task"] == "rule_calculation"


@pytest.mark.parametrize("has_key", [False, True], ids=["without-key", "keyed"])
@pytest.mark.parametrize(
    "is_deployment", [False, True], ids=["instance", "deployment"]
)
async def test_task_receipt_keeps_created_resource_in_operator_audit(
    app_context: AppContext, has_key: bool, is_deployment: bool
) -> None:
    client = app_context.client
    template = await make_template(client)
    headers = {"Idempotency-Key": "created-resource-audit"} if has_key else {}
    response = await client.post(
        INSTANCES,
        json={
            "template_id": template["id"],
            "code": "audit-id",
            "name": "审计身份",
        },
        headers=headers if not is_deployment else {},
    )
    assert response.status_code == 201, response.text
    operation = "create_instance"
    if is_deployment:
        instance_id = _identity(data_of(response))
        version = await _version(
            app_context.session, instance_id, "regression", 1
        )
        response = await client.post(
            f"{INSTANCES}/{instance_id}:deploy",
            json={
                "model_version_id": version,
                "code": "audit-deploy",
                "name": "审计部署",
            },
            headers=headers,
        )
        assert response.status_code == 201, response.text
        operation = "deploy_instance"
    audit = await app_context.session.scalar(
        select(ModelingOperatorAudit).where(
            ModelingOperatorAudit.operation == operation,
            ModelingOperatorAudit.account_user_id
            == uuid.UUID(client.headers["X-Auth-User-Id"]),
        )
    )
    assert audit is not None
    assert audit.resource_id == uuid.UUID(_identity(data_of(response)))


async def test_old_durable_configuration_receipt_keeps_first_revision(
    app_context: AppContext,
) -> None:
    client = app_context.client
    instance = await make_instance(client)
    url = f"{INSTANCES}/{instance['id']}/configuration"
    configuration = data_of(await client.get(url))["configuration"]
    payload = {
        "expected_revision": 1,
        "configuration": configuration,
        "name": "首次配置",
    }
    headers = {"Idempotency-Key": "old-configuration-receipt"}
    first = await client.put(url, json=payload, headers=headers)
    assert first.status_code == 200, first.text
    await _remove_durable_task(app_context, first)
    changed = await client.put(
        url,
        json={
            "expected_revision": 2,
            "configuration": configuration,
            "name": "后来配置",
        },
    )
    assert changed.status_code == 200, changed.text
    replay = await client.put(url, json=payload, headers=headers)
    assert replay.status_code == 200, replay.text
    assert data_of(replay) == data_of(first)
    assert data_of(replay)["revision"] == 2
    current = _OBJECT.validate_python(
        data_of(await client.get(url))["instance"]
    )
    assert current["revision"] == 3


@pytest.mark.parametrize("operation", ["archive", "restore"])
async def test_old_durable_instance_state_receipt_keeps_first_state(
    app_context: AppContext, operation: str
) -> None:
    client = app_context.client
    instance = await make_instance(client)
    base = f"{INSTANCES}/{instance['id']}"
    if operation == "restore":
        assert (
            await client.post(f"{base}:archive", json={})
        ).status_code == 200
    url = f"{base}:{operation}"
    headers = {"Idempotency-Key": "old-instance-state"}
    first = await client.post(url, json={}, headers=headers)
    assert first.status_code == 200, first.text
    await _remove_durable_task(app_context, first)
    reverse = "restore" if operation == "archive" else "archive"
    changed = await client.post(f"{base}:{reverse}", json={})
    assert changed.status_code == 200, changed.text
    replay = await client.post(url, json={}, headers=headers)
    assert replay.status_code == 200, replay.text
    assert data_of(replay) == data_of(first)
    current = data_of(await client.get(base))
    assert current["archived_at"] != data_of(replay)["archived_at"]


async def _deployment_request(
    context: AppContext, operation: str
) -> tuple[str, str, dict[str, object]]:
    client = context.client
    instance = await make_instance(client)
    first = await _version(
        context.session, _identity(instance), "regression", 1
    )
    second = await _version(
        context.session, _identity(instance), "regression", 2
    )
    payload: dict[str, object] = {
        "model_version_id": first,
        "code": "direct-receipt",
        "name": "首次服务",
    }
    if operation == "create":
        return "POST", DEPLOYMENTS, payload
    response = await client.post(DEPLOYMENTS, json=payload)
    assert response.status_code == 201, response.text
    url = f"{DEPLOYMENTS}/{data_of(response)['id']}"
    if operation == "update":
        return "PATCH", url, {"name": "首次改名"}
    switch: dict[str, object] = {
        "expected_revision": 1,
        "model_version_id": second,
    }
    if operation == "switch":
        return "POST", f"{url}:switch", switch
    switched = await client.post(f"{url}:switch", json=switch)
    assert switched.status_code == 200, switched.text
    history = _OBJECTS.validate_python(
        data_of(await client.get(f"{url}/switches"))["items"]
    )
    return (
        "POST",
        f"{url}:rollback",
        {"expected_revision": 2, "switch_id": history[0]["id"]},
    )


@pytest.mark.parametrize(
    "operation", ["create", "update", "switch", "rollback"]
)
async def test_old_durable_deployment_receipt_keeps_first_response(
    app_context: AppContext, operation: str
) -> None:
    client = app_context.client
    method, url, payload = await _deployment_request(app_context, operation)
    headers = {"Idempotency-Key": "old-direct-deployment"}
    first = await client.request(method, url, json=payload, headers=headers)
    assert first.status_code in (200, 201), first.text
    await _remove_durable_task(app_context, first)
    current_url = f"{DEPLOYMENTS}/{data_of(first)['id']}"
    changed = await client.patch(current_url, json={"name": "后来的名称"})
    assert changed.status_code == 200, changed.text
    replay = await client.request(method, url, json=payload, headers=headers)
    assert replay.status_code == first.status_code, replay.text
    assert data_of(replay) == data_of(first)
    assert data_of(await client.get(current_url))["name"] == "后来的名称"


async def test_legacy_deployment_receipt_without_task_still_blocks_creation(
    app_context: AppContext,
) -> None:
    client = app_context.client
    method, url, payload = await _deployment_request(app_context, "create")
    first = await client.request(method, url, json=payload)
    assert first.status_code == 201, first.text
    saved = TaskReceipt.model_validate(data_of(first)).root
    del saved["task"]

    async def previous_success() -> TaskReceipt:
        return TaskReceipt(saved)

    await app_context.idempotency.run_once(
        endpoint="modeling.create_deployment",
        key="legacy-direct-deployment",
        caller=uuid.UUID(client.headers["X-Auth-User-Id"]),
        model=TaskReceipt,
        action=previous_success,
    )
    refused = await client.post(
        DEPLOYMENTS,
        json={**payload, "code": "must-not-create"},
        headers={"Idempotency-Key": "legacy-direct-deployment"},
    )
    assert refused.status_code == 409, refused.text
    assert _OBJECT.validate_json(refused.content)["code"] == 41444
    assert len(_list_of(await client.get(DEPLOYMENTS))) == 1
