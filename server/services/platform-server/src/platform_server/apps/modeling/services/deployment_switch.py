"""受修订、归属及签名保护的部署版本切换。"""

import uuid

from pydantic import JsonValue, TypeAdapter
from sqlalchemy.ext.asyncio import AsyncSession

from lib.web import CursorPage
from platform_server.apps.modeling.crud import (
    deployment_crud,
    model_version_crud,
)
from platform_server.apps.modeling.crud import deployment_switch as switches
from platform_server.apps.modeling.errors import (
    DeploymentNotFound,
    ModelVersionNotFound,
    ModelVersionUnservable,
)
from platform_server.apps.modeling.management_errors import (
    DeploymentRevisionConflict,
    DeploymentSignatureChanged,
    DeploymentSwitchNotFound,
    DeploymentVersionMismatch,
)
from platform_server.apps.modeling.models import (
    ModelingDeployment,
    ModelVersion,
)
from platform_server.apps.modeling.models.deployment_switch import (
    ModelingDeploymentSwitch,
)
from platform_server.apps.modeling.schemas.deployment import ModelDeploymentOut
from platform_server.apps.modeling.schemas.management import (
    DeploymentRollbackIn,
    DeploymentSwitchIn,
    DeploymentSwitchOut,
    ManagementListQuery,
)
from platform_server.apps.modeling.services import deployment_service
from platform_server.apps.modeling.services.management_cursor import (
    paginate,
    read_cursor,
)
from platform_server.apps.modeling.services.management_guard import (
    require_active_version,
)
from platform_server.apps.modeling.services.pipeline_service import Actor
from platform_server.apps.modeling.services.template_service import record_audit


async def switch_deployment(
    session: AsyncSession,
    identity: uuid.UUID,
    payload: DeploymentSwitchIn,
    actor: Actor,
) -> ModelDeploymentOut:
    return await _switch(session, identity, payload, actor, None)


async def rollback_deployment(
    session: AsyncSession,
    identity: uuid.UUID,
    payload: DeploymentRollbackIn,
    actor: Actor,
) -> ModelDeploymentOut:
    previous = await switches.get_switch(session, payload.switch_id)
    if previous is None or previous.deployment_id != identity:
        raise DeploymentSwitchNotFound("部署切换记录不存在")
    target = previous.from_model_id or previous.from_rule_id
    if target is None:
        raise DeploymentSwitchNotFound("切换记录没有可回滚版本")
    command = DeploymentSwitchIn(
        expected_revision=payload.expected_revision,
        model_version_id=target,
        is_signature_change_confirmed=payload.is_signature_change_confirmed,
    )
    return await _switch(session, identity, command, actor, previous.id)


async def _switch(
    session: AsyncSession,
    identity: uuid.UUID,
    payload: DeploymentSwitchIn,
    actor: Actor,
    rollback_of: uuid.UUID | None,
) -> ModelDeploymentOut:
    deployment = await deployment_crud.get_for_update(session, identity)
    if deployment is None:
        raise DeploymentNotFound("部署不存在")
    if (deployment.revision or 1) != payload.expected_revision:
        raise DeploymentRevisionConflict("部署已修改，请重新读取")
    source = await model_version_crud.get(
        session, deployment.effective_version_id
    )
    if source is None:
        raise ModelVersionNotFound("当前模型版本不存在")
    target = await require_active_version(session, payload.model_version_id)
    _check_switch(source, target, payload)
    if source.id == target.id:
        return await deployment_service.get_deployment(session, identity)
    _apply_version(deployment, target)
    switches.add_switch(
        session,
        _switch_row(deployment, source, target, payload, (actor, rollback_of)),
    )
    record_audit(
        session,
        actor,
        (
            "deployment_version_rolled_back"
            if rollback_of
            else "deployment_version_switched"
        ),
        identity,
        (
            {"model_version_id": str(source.id)},
            {
                "model_version_id": str(target.id),
                "revision": deployment.revision,
            },
        ),
    )
    await session.flush()
    return await deployment_service.get_deployment(session, identity)


def _apply_version(
    deployment: ModelingDeployment, target: ModelVersion
) -> None:
    deployment.model_version_id = (
        target.id if target.task != "rule_calculation" else None
    )
    deployment.rule_version_id = (
        target.id if target.task == "rule_calculation" else None
    )
    deployment.revision = (deployment.revision or 1) + 1


def _check_switch(
    source: ModelVersion, target: ModelVersion, payload: DeploymentSwitchIn
) -> None:
    if source.pipeline_id != target.pipeline_id or source.task != target.task:
        raise DeploymentVersionMismatch("请选择同一模型且任务类型相同的版本")
    if not target.servable:
        raise ModelVersionUnservable("目标模型版本不可服务")
    if (
        _signature_contract(source) != _signature_contract(target)
        and not payload.is_signature_change_confirmed
    ):
        raise DeploymentSignatureChanged(
            "模型输入输出签名已改变，请核对并显式确认"
        )


def _switch_row(
    deployment: ModelingDeployment,
    source: ModelVersion,
    target: ModelVersion,
    payload: DeploymentSwitchIn,
    context: tuple[Actor, uuid.UUID | None],
) -> ModelingDeploymentSwitch:
    actor, rollback_of = context
    return ModelingDeploymentSwitch(
        deployment_id=deployment.id,
        deployment_code=deployment.code,
        from_model_id=source.id if source.task != "rule_calculation" else None,
        from_rule_id=source.id if source.task == "rule_calculation" else None,
        to_model_id=target.id if target.task != "rule_calculation" else None,
        to_rule_id=target.id if target.task == "rule_calculation" else None,
        revision=deployment.revision,
        rollback_of_id=rollback_of,
        is_signature_change_confirmed=payload.is_signature_change_confirmed,
        created_by_name=actor.name,
    )


async def list_switches(
    session: AsyncSession, identity: uuid.UUID, query: ManagementListQuery
) -> CursorPage[DeploymentSwitchOut]:
    await deployment_service.get_deployment(session, identity)
    query = query.model_copy(update={"pagination": "cursor"})
    resource = f"deployment-switches:{identity}"
    rows = await switches.list_switches(
        session, identity, query.limit, read_cursor(query, resource)
    )
    items = [
        DeploymentSwitchOut(
            id=row.id,
            deployment_id=row.deployment_id,
            deployment_code=row.deployment_code,
            from_model_version_id=row.from_version_id,
            to_model_version_id=row.to_version_id,
            revision=row.revision,
            rollback_of_id=row.rollback_of_id,
            is_signature_change_confirmed=row.is_signature_change_confirmed,
            created_by_name=row.created_by_name,
            created_at=row.created_at,
        )
        for row in rows
    ]
    result = paginate(items, 0, query, resource)
    if not isinstance(result, CursorPage):
        raise RuntimeError("切换历史必须使用游标分页")
    return result


def _signature_contract(version: ModelVersion) -> dict[str, JsonValue]:
    signature = TypeAdapter(dict[str, JsonValue]).validate_python(
        version.signature_json
    )
    inputs = signature.get("inputs")
    if not isinstance(inputs, list) or not inputs:
        return {
            "inputs": version.feature_keys,
            "output": {"key": version.target_key, "task": version.task},
            "rule_result": _rule_result_contract(version),
        }
    return {
        "format_version": signature.get("format_version"),
        "requires_timestamp": signature.get("requires_timestamp"),
        "inputs": [
            {
                key: value
                for key, value in item.items()
                if key not in {"label", "training_stats", "description"}
            }
            for item in inputs
            if isinstance(item, dict)
        ],
        "output": signature.get("output"),
        "rule_result": _rule_result_contract(version),
    }


def _rule_result_contract(version: ModelVersion) -> JsonValue:
    if version.task != "rule_calculation":
        return None
    serving = TypeAdapter(dict[str, JsonValue]).validate_python(
        version.serving_json
    )
    steps = serving.get("steps")
    if not isinstance(steps, list):
        return None
    return [
        step.get("config")
        for step in steps
        if isinstance(step, dict) and step.get("operator") == "energy_rules"
    ]
