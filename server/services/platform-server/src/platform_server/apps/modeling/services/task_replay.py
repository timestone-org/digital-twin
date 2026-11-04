"""建模幂等回执的任务与服务地址兼容，保留首次结果与原缓存身份。"""

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING

from pydantic import BaseModel, JsonValue, RootModel, TypeAdapter
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.modeling.protocols import ModelTask
from platform_server.apps.modeling.schemas import ModelDeploymentOut
from platform_server.apps.modeling.schemas.template import (
    ModelingInstanceOut,
    ModelingTemplateOut,
)
from platform_server.apps.modeling.services import (
    instance_service,
    model_service,
    template_service,
)
from platform_server.apps.modeling.services.serving_contract import (
    invoke_url,
    signature_url,
)

if TYPE_CHECKING:
    from platform_server.deps import WriteGate

type TaskResult = (
    ModelDeploymentOut | ModelingInstanceOut | ModelingTemplateOut
)


class TaskReceipt(RootModel[dict[str, JsonValue]]):
    """原样保存首次响应对象，允许升级前的回执缺少新增任务字段。"""

    @property
    def id(self) -> uuid.UUID:
        """为持久命令审计透传已验证的资源身份。"""
        return uuid.UUID(str(self.root["id"]))


@dataclass(frozen=True)
class TaskCommand[ResultT: TaskResult]:
    """一条使用稳定幂等端点和输出形状的建模创建命令。"""

    endpoint: str
    model: type[ResultT]
    action: Callable[[], Awaitable[ResultT]]


async def run_task_once[ResultT: TaskResult](
    session: AsyncSession,
    gate: "WriteGate",
    command: TaskCommand[ResultT],
) -> ResultT:
    """为首次回执补齐真实模型任务；Args: session, gate, command。"""

    async def action() -> TaskReceipt:
        result = await command.action()
        return TaskReceipt.model_validate(
            result.model_dump(mode="json", by_alias=True)
        )

    receipt = await gate.run_once(
        endpoint=command.endpoint, model=TaskReceipt, action=action
    )
    payload = await payload_with_task(session, command.model, receipt.root)
    return command.model.model_validate(payload)


def requires_task(model: type[BaseModel]) -> bool:
    """识别新增任务字段的既有输出形状；Args: model。"""
    return model in (
        ModelDeploymentOut,
        ModelingInstanceOut,
        ModelingTemplateOut,
    )


async def payload_with_task(
    session: AsyncSession,
    model: type[BaseModel],
    payload: dict[str, JsonValue],
) -> dict[str, JsonValue]:
    """补齐旧回执的任务和部署地址；Args: session, model, payload。"""
    if not requires_task(model):
        return payload
    result = dict(payload)
    if "task" not in result:
        result["task"] = await _task_of_receipt(session, model, payload)
    if model is ModelDeploymentOut:
        task = TypeAdapter[ModelTask](ModelTask).validate_python(result["task"])
        code = str(result["code"])
        result.setdefault("invoke_url", invoke_url(code, task))
        result.setdefault("signature_url", signature_url(code))
    return result


async def _task_of_receipt(
    session: AsyncSession,
    model: type[BaseModel],
    payload: dict[str, JsonValue],
) -> ModelTask:
    """按回执中的不可变来源读取类型；Args: session, model, payload。"""
    if model is ModelDeploymentOut:
        version_id = uuid.UUID(str(payload["model_version_id"]))
        return (await model_service.get_version(session, version_id)).task
    resource_id = uuid.UUID(str(payload["id"]))
    if model is ModelingTemplateOut:
        return (await template_service.get_template(session, resource_id)).task
    return (await instance_service.get_instance(session, resource_id)).task
