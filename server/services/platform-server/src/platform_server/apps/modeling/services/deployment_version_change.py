"""校验并记录锁定部署上的模型版本变更。"""

import uuid

from pydantic import JsonValue, TypeAdapter
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.modeling.crud import deployment_switch as switches
from platform_server.apps.modeling.crud import model_version_crud
from platform_server.apps.modeling.errors import (
    ModelVersionNotFound,
    ModelVersionUnservable,
)
from platform_server.apps.modeling.management_errors import (
    DeploymentRevisionConflict,
    DeploymentSignatureChanged,
    DeploymentVersionMismatch,
)
from platform_server.apps.modeling.models import (
    ModelingDeployment,
    ModelVersion,
)
from platform_server.apps.modeling.models.deployment_switch import (
    ModelingDeploymentSwitch,
)
from platform_server.apps.modeling.schemas.management import DeploymentSwitchIn
from platform_server.apps.modeling.services.management_guard import (
    require_active_version,
)
from platform_server.apps.modeling.services.pipeline_service import Actor
from platform_server.apps.modeling.services.template_service import record_audit


def require_revision(
    deployment: ModelingDeployment, expected: int | None
) -> None:
    """核对调用方提供的部署修订号。Args: deployment, expected。"""
    if expected is not None and (deployment.revision or 1) != expected:
        raise DeploymentRevisionConflict("部署已修改，请重新读取")


async def change_version(
    session: AsyncSession,
    deployment: ModelingDeployment,
    payload: DeploymentSwitchIn,
    actor: Actor,
    rollback_of: uuid.UUID | None = None,
) -> None:
    """在锁定的部署上校验目标并记录切换。

    Args: session, deployment, payload, actor, rollback_of。
    """
    require_revision(deployment, payload.expected_revision)
    source = await model_version_crud.get(
        session, deployment.effective_version_id
    )
    if source is None:
        raise ModelVersionNotFound("当前模型版本不存在")
    target = await require_active_version(session, payload.model_version_id)
    require_compatible_version(source, target, payload)
    if source.id == target.id:
        return
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
        deployment.id,
        (
            {"model_version_id": str(source.id)},
            {
                "model_version_id": str(target.id),
                "revision": deployment.revision,
            },
        ),
    )


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


def require_compatible_version(
    source: ModelVersion, target: ModelVersion, payload: DeploymentSwitchIn
) -> None:
    """校验目标的归属、任务和签名。Args: source, target, payload。"""
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


def _signature_contract(version: ModelVersion) -> dict[str, JsonValue]:
    signature = TypeAdapter(dict[str, JsonValue]).validate_python(
        version.signature_json
    )
    inputs = signature.get("inputs")
    if not isinstance(inputs, list) or not inputs:
        return {
            "inputs": version.feature_keys,
            "data_period": signature.get("data_period"),
            "output": {"key": version.target_key, "task": version.task},
            "rule_result": _rule_result_contract(version),
        }
    return {
        "format_version": signature.get("format_version"),
        "requires_timestamp": signature.get("requires_timestamp"),
        "data_period": signature.get("data_period"),
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
