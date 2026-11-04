"""终态训练记录及未被引用的模型原子删除。"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import after_commit
from lib.logging import get_logger
from lib.objectstore import ObjectStore, ObjectStoreError
from platform_server.apps.modeling.crud import (
    model_version_crud,
    pipeline_crud,
    run_crud,
)
from platform_server.apps.modeling.management_errors import RunNotDeletable
from platform_server.apps.modeling.protocols import ACTIVE_RUN_STATUSES
from platform_server.apps.modeling.schemas.command import CommandResourceOut
from platform_server.apps.modeling.services import artifact_store, model_service
from platform_server.apps.modeling.services.run_service import require_run

_logger = get_logger("platform.modeling.deletion")


async def delete_run(
    session: AsyncSession,
    run_id: uuid.UUID,
    store: ObjectStore | None,
) -> CommandResourceOut:
    """删除终态训练和未使用的模型；Args: session, run_id, store。"""
    run = await require_run(session, run_id)
    await pipeline_crud.lock(session, run.pipeline_id)
    await session.refresh(run, with_for_update=True)
    if run.status in ACTIVE_RUN_STATUSES or run.publication_status == "pending":
        raise RunNotDeletable("训练或模型发布仍在进行，请等待完成后删除")
    version = await model_version_crud.get_by_run(session, run_id)
    version_id = version.id if version else None
    if version is not None:
        await model_service.retire_version(session, version.id)
        await session.flush()
    await run_crud.delete(session, run)
    await session.flush()
    if store is not None:
        after_commit(
            session, lambda: _clean_artifacts(store, run_id, version_id)
        )
    return CommandResourceOut(id=run_id)


async def _clean_artifacts(
    store: ObjectStore,
    run_id: uuid.UUID,
    version_id: uuid.UUID | None,
) -> None:
    try:
        await store.delete_prefix(artifact_store.run_prefix(str(run_id)))
        if version_id is not None:
            await store.delete_prefix(artifact_store.model_key(str(version_id)))
    except ObjectStoreError as error:
        _logger.warning(
            "modeling_deleted_artifact_cleanup_failed",
            "训练记录已删除，产物清理失败",
            run_id=str(run_id),
            error=error,
        )
