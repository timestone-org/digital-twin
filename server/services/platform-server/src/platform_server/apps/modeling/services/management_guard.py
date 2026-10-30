"""所有模型写入口共用的归档守卫与锁顺序。"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.modeling.crud import (
    management_state,
    model_version_crud,
)
from platform_server.apps.modeling.errors import ModelVersionNotFound
from platform_server.apps.modeling.management_errors import ModelingArchived
from platform_server.apps.modeling.models import ModelVersion


async def require_active_instance(
    session: AsyncSession, identity: uuid.UUID
) -> None:
    instance = await management_state.lock_instance(session, identity)
    if instance is not None and instance.archived_at is not None:
        raise ModelingArchived("模型实例已归档，请先恢复")


async def require_active_version(
    session: AsyncSession, identity: uuid.UUID
) -> ModelVersion:
    version = await model_version_crud.get(session, identity)
    if version is None:
        raise ModelVersionNotFound("模型版本不存在")
    await require_active_instance(session, version.pipeline_id)
    version = await management_state.lock_version(session, identity)
    if version is None:
        raise ModelVersionNotFound("模型版本不存在")
    if version.archived_at is not None:
        raise ModelingArchived("模型版本已归档，请先恢复")
    return version
