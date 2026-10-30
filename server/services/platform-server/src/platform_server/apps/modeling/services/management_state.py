"""模型归档与恢复，保留身份及全部计算内容。"""

import uuid
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.modeling.crud import (
    management_state,
    model_version_crud,
)
from platform_server.apps.modeling.errors import (
    InstanceNotFound,
    InstanceRevisionConflict,
    ModelVersionNotFound,
)
from platform_server.apps.modeling.management_errors import (
    ModelingResourceInUse,
)
from platform_server.apps.modeling.schemas.management import ArchiveIn
from platform_server.apps.modeling.schemas.model import ModelVersionOut
from platform_server.apps.modeling.schemas.template import ModelingInstanceOut
from platform_server.apps.modeling.services import (
    instance_service,
    model_service,
)
from platform_server.apps.modeling.services.pipeline_service import Actor
from platform_server.apps.modeling.services.template_service import record_audit


async def set_instance_archive(
    session: AsyncSession,
    identity: uuid.UUID,
    payload: ArchiveIn,
    actor: Actor,
    moment: datetime | None,
) -> ModelingInstanceOut:
    instance = await management_state.lock_instance(session, identity)
    if instance is None:
        raise InstanceNotFound("模型实例不存在")
    if (
        payload.expected_revision is not None
        and payload.expected_revision != instance.revision
    ):
        raise InstanceRevisionConflict("模型实例已修改，请重新读取")
    if moment is not None and await management_state.instance_references(
        session, identity
    ):
        raise ModelingResourceInUse("模型仍有在途训练、部署或公式引用")
    if (instance.archived_at is None) == (moment is None):
        return await instance_service.get_instance(session, identity)
    before: dict[str, object] = {
        "archived_at": (
            instance.archived_at.isoformat() if instance.archived_at else None
        )
    }
    instance.archived_at = moment
    instance.revision += 1
    record_audit(
        session,
        actor,
        "instance_archived" if moment else "instance_restored",
        identity,
        (before, {"archived_at": moment.isoformat() if moment else None}),
    )
    await session.flush()
    return await instance_service.get_instance(session, identity)


async def set_version_archive(
    session: AsyncSession,
    identity: uuid.UUID,
    actor: Actor,
    moment: datetime | None,
) -> ModelVersionOut:
    version = await model_version_crud.get(session, identity)
    if version is None:
        raise ModelVersionNotFound("模型版本不存在")
    await management_state.lock_instance(session, version.pipeline_id)
    version = await management_state.lock_version(session, identity)
    if version is None:
        raise ModelVersionNotFound("模型版本不存在")
    if moment is not None and await management_state.version_references(
        session, identity
    ):
        raise ModelingResourceInUse("模型版本仍有部署或公式引用")
    if (version.archived_at is None) == (moment is None):
        return await model_service.get_version(session, identity)
    before: dict[str, object] = {
        "archived_at": (
            version.archived_at.isoformat() if version.archived_at else None
        )
    }
    version.archived_at = moment
    record_audit(
        session,
        actor,
        "version_archived" if moment else "version_restored",
        identity,
        (before, {"archived_at": moment.isoformat() if moment else None}),
    )
    await session.flush()
    return await model_service.get_version(session, identity)
