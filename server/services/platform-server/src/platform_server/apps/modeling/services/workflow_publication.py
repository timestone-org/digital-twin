"""工作流训练模型的冻结与单一稳定入口发布。"""

import uuid
from dataclasses import dataclass, field

from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors import AppError
from lib.logging import get_logger
from lib.objectstore import ObjectStore
from platform_server.apps.modeling.crud import (
    deployment_crud,
    model_version_crud,
    pipeline_crud,
    run_crud,
)
from platform_server.apps.modeling.errors import (
    ModelVersionUnservable,
    RunNotFound,
    RunNotPublishable,
)
from platform_server.apps.modeling.management_errors import (
    DeploymentRevisionConflict,
    WorkflowDeploymentConflict,
)
from platform_server.apps.modeling.schemas import (
    ModelDeploymentCreateIn,
    ModelDeploymentOut,
    ModelVersionCreateIn,
    ModelVersionOut,
)
from platform_server.apps.modeling.schemas.management import DeploymentSwitchIn
from platform_server.apps.modeling.schemas.run import RunDeployIn
from platform_server.apps.modeling.services import (
    deployment_service,
    deployment_switch,
    model_service,
)
from platform_server.apps.modeling.services.pipeline_service import (
    Actor,
    require_pipeline,
)
from platform_server.apps.modeling.services.sessions import Sessions
from platform_server.apps.modeling.services.template_service import record_audit

_logger = get_logger("platform.modeling.publication")


@dataclass(frozen=True)
class PublicationContext:
    sessions: Sessions
    actor: Actor
    store: ObjectStore | None


@dataclass
class RunDeploymentCommand:
    session: AsyncSession
    run_id: uuid.UUID
    payload: RunDeployIn
    context: PublicationContext
    _prepared: model_service.PreparedVersion | None = field(
        default=None, init=False
    )

    async def prepare(self) -> None:
        self._prepared = await prepare_training_version(
            self.context.sessions,
            self.run_id,
            self.context.actor,
            self.context.store,
        )

    async def execute(self) -> ModelDeploymentOut:
        if self._prepared is not None:
            await model_service.save_prepared_version(
                self.session, self._prepared, is_reusing_existing=True
            )
        return await deploy_run(
            self.session,
            self.run_id,
            self.payload,
            self.context.actor,
            self.context.store,
        )


async def deploy_run(
    session: AsyncSession,
    run_id: uuid.UUID,
    payload: RunDeployIn,
    actor: Actor,
    store: ObjectStore | None = None,
) -> ModelDeploymentOut:
    """发布到工作流入口；Args: session, run_id, payload, actor, store。"""
    version = await ensure_version(session, run_id, actor, store)
    result = await _deploy_version(session, version, payload, actor)
    run = await run_crud.get(session, run_id)
    if run is not None:
        run.publication_status = "published"
        run.publication_error = None
    record_audit(
        session,
        actor,
        "workflow_model_published",
        version.pipeline_id,
        (
            None,
            {
                "run_id": str(run_id),
                "model_version_id": str(version.id),
                "deployment_id": str(result.id),
            },
        ),
    )
    return result


async def _deploy_version(
    session: AsyncSession,
    version: ModelVersionOut,
    payload: RunDeployIn,
    actor: Actor,
) -> ModelDeploymentOut:
    if not version.is_servable:
        raise ModelVersionUnservable(
            version.unservable_reason or "该训练模型不能部署"
        )
    await pipeline_crud.lock(session, version.pipeline_id)
    rows = await deployment_crud.for_pipeline(session, version.pipeline_id)
    if len(rows) > 1:
        raise WorkflowDeploymentConflict(
            "此工作流存在多个历史部署，请先清理至一个发布入口"
        )
    if rows:
        result = await deployment_switch.switch_deployment(
            session,
            rows[0].id,
            DeploymentSwitchIn(
                expected_revision=rows[0].revision or 1,
                model_version_id=version.id,
                is_signature_change_confirmed=payload.is_signature_change_confirmed,
            ),
            actor,
        )
    else:
        pipeline = await require_pipeline(session, version.pipeline_id)
        result = await deployment_service.create_deployment(
            session,
            payload=ModelDeploymentCreateIn(
                code=f"workflow-{pipeline.id.hex}",
                name=pipeline.name,
                model_version_id=version.id,
                description=pipeline.description,
            ),
            actor=actor,
        )
    return result


async def ensure_version(
    session: AsyncSession,
    run_id: uuid.UUID,
    actor: Actor,
    store: ObjectStore | None = None,
) -> ModelVersionOut:
    """冻结训练模型；Args: session, run_id, actor, store。"""
    existing = await model_version_crud.get_by_run(session, run_id)
    if existing is not None:
        return await model_service.get_version(session, existing.id)
    run = await run_crud.get(session, run_id)
    if run is None:
        raise RunNotFound("训练记录不存在")
    pipeline = await require_pipeline(session, run.pipeline_id)
    return await model_service.publish_version(
        session,
        payload=ModelVersionCreateIn(run_id=run_id, name=pipeline.name),
        actor=actor,
        store=store,
    )


async def complete_training(
    sessions: Sessions,
    run_id: uuid.UUID,
    store: ObjectStore | None = None,
) -> None:
    """保存模型并按需发布；Args: sessions, run_id, store。"""
    async with sessions.session() as session:
        run = await run_crud.get(session, run_id)
        if run is None or run.publication_status != "pending":
            return
        if run.status != "succeeded":
            if run.status in {"failed", "cancelled"}:
                run.publication_status = "skipped"
                run.publication_error = "训练未成功，已保留现有发布模型"
            return
        actor = Actor(
            user_id=run.created_by or "", name=run.created_by_name or "系统"
        )
        should_publish = bool(run.auto_publish)
    try:
        await _save_training_version(sessions, run_id, actor, store)
        async with sessions.session() as session:
            if should_publish:
                if await _require_expected_deployment(session, run_id):
                    await deploy_run(
                        session, run_id, RunDeployIn(), actor, store
                    )
            else:
                await _set_result(session, run_id, "not_requested", None)
    except RunNotPublishable as error:
        await _record_failure(sessions, run_id, "skipped", error.message)
    except AppError as error:
        await _record_failure(sessions, run_id, "failed", error.message)
    except Exception as error:
        _logger.warning(
            "modeling_training_publication_failed",
            "训练后保存或发布模型失败",
            run_id=str(run_id),
            error=error,
        )
        await _record_failure(
            sessions,
            run_id,
            "failed",
            "训练完成，但保存或发布模型失败，请手动核查后发布",
        )


async def _save_training_version(
    sessions: Sessions,
    run_id: uuid.UUID,
    actor: Actor,
    store: ObjectStore | None,
) -> None:
    prepared = await prepare_training_version(sessions, run_id, actor, store)
    if prepared is None:
        return
    async with sessions.session() as session:
        version = await model_service.save_prepared_version(
            session, prepared, is_reusing_existing=True
        )
        record_audit(
            session,
            actor,
            "training_model_saved",
            version.pipeline_id,
            (
                None,
                {"run_id": str(run_id), "model_version_id": str(version.id)},
            ),
        )


async def prepare_training_version(
    sessions: Sessions,
    run_id: uuid.UUID,
    actor: Actor,
    store: ObjectStore | None,
) -> model_service.PreparedVersion | None:
    async with sessions.session() as session:
        if await model_version_crud.get_by_run(session, run_id) is not None:
            return None
        source = await model_service.load_version_source(session, run_id)
        pipeline = await require_pipeline(session, source.run.pipeline_id)
        payload = ModelVersionCreateIn(run_id=run_id, name=pipeline.name)
    return await model_service.prepare_version(source, payload, actor, store)


async def _require_expected_deployment(
    session: AsyncSession,
    run_id: uuid.UUID,
) -> bool:
    run = await run_crud.get(session, run_id)
    if run is None:
        raise RunNotFound("训练记录不存在")
    await pipeline_crud.lock(session, run.pipeline_id)
    await session.refresh(run)
    if run.publication_status != "pending":
        return False
    rows = await deployment_crud.for_pipeline(session, run.pipeline_id)
    if len(rows) > 1:
        raise WorkflowDeploymentConflict("工作流存在多个历史部署，请先清理")
    expected = run.publication_expected_revision
    if expected is None:
        return True
    if not rows and expected == 0:
        return True
    if (
        rows
        and rows[0].id == run.publication_deployment_id
        and (rows[0].revision or 1) == expected
    ):
        return True
    raise DeploymentRevisionConflict(
        "训练期间发布入口已被修改，已保留当前部署，请手动核对后发布"
    )


async def _record_failure(
    sessions: Sessions,
    run_id: uuid.UUID,
    status: str,
    message: str,
) -> None:
    async with sessions.session() as session:
        await _set_result(session, run_id, status, message)


async def _set_result(
    session: AsyncSession,
    run_id: uuid.UUID,
    status: str,
    message: str | None,
) -> None:
    run = await run_crud.get(session, run_id)
    if run is not None and run.publication_status == "pending":
        run.publication_status = status
        run.publication_error = message
