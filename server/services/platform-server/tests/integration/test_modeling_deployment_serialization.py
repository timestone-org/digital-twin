"""部署删除、修改和切换与训练自动发布共用工作流行锁。"""

import asyncio
import uuid

import pytest
from conftest import AppContext
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from integration.test_modeling_version_numbering import (
    _cleanup,
    _seed_deployment,
)
from lib.db import Database
from lib.utils.ids import uuid7
from platform_server.apps.modeling.management_errors import (
    DeploymentRevisionConflict,
)
from platform_server.apps.modeling.models import ModelingPipeline
from platform_server.apps.modeling.models.deployment_switch import (
    ModelingDeploymentSwitch,
)
from platform_server.apps.modeling.schemas import ModelDeploymentUpdateIn
from platform_server.apps.modeling.schemas.management import DeploymentSwitchIn
from platform_server.apps.modeling.services import (
    deployment_service,
    deployment_switch,
)
from platform_server.apps.modeling.services.pipeline_service import Actor
from platform_server.settings import Settings


async def _mutate(
    session: AsyncSession,
    operation: str,
    identity: uuid.UUID,
    version_id: uuid.UUID,
) -> None:
    if operation == "delete":
        await deployment_service.delete_deployment(session, identity)
    elif operation == "patch":
        await deployment_service.update_deployment(
            session,
            deployment_id=identity,
            payload=ModelDeploymentUpdateIn(name="人工改名"),
            actor=Actor(user_id="test", name="测试员"),
        )
    else:
        await deployment_switch.switch_deployment(
            session,
            identity,
            DeploymentSwitchIn(
                expected_revision=1, model_version_id=version_id
            ),
            Actor(user_id="test", name="测试员"),
        )


async def _contend(
    database: Database,
    operation: str,
    deployment_id: uuid.UUID,
    version_id: uuid.UUID,
) -> None:
    async with database.session() as session:
        await session.execute(text("SET LOCAL lock_timeout = '100ms'"))
        await _mutate(session, operation, deployment_id, version_id)


@pytest.mark.parametrize("operation", ["delete", "patch", "switch"])
async def test_deployment_mutations_wait_for_the_workflow_publication_lock(
    settings: Settings,
    app_context: AppContext,
    operation: str,
) -> None:
    del app_context
    database = Database(dsn=settings.dsn(), search_path="platform")
    pipeline_id = uuid7()
    try:
        deployment_id, version_id, _ = await _seed_deployment(
            database, pipeline_id
        )
        async with database.session() as publishing:
            await publishing.execute(
                select(ModelingPipeline.id)
                .where(ModelingPipeline.id == pipeline_id)
                .with_for_update()
            )
            with pytest.raises(DBAPIError, match="lock timeout"):
                await _contend(database, operation, deployment_id, version_id)
    finally:
        await _cleanup(database, pipeline_id)


async def test_concurrent_editors_record_one_switch_per_revision(
    settings: Settings, app_context: AppContext
) -> None:
    del app_context
    database = Database(dsn=settings.dsn(), search_path="platform")
    pipeline_id = uuid7()
    try:
        deployment, _, target = await _seed_deployment(database, pipeline_id)
        ready = asyncio.Barrier(2)

        async def edit() -> bool:
            async with database.session() as session:
                await ready.wait()
                try:
                    await deployment_service.update_deployment(
                        session,
                        deployment_id=deployment,
                        payload=ModelDeploymentUpdateIn(
                            model_version_id=target, expected_revision=1
                        ),
                        actor=Actor(user_id="test", name="编辑者"),
                    )
                except DeploymentRevisionConflict:
                    return False
                return True

        assert sorted(await asyncio.gather(edit(), edit())) == [False, True]
        async with database.session() as session:
            switches = await session.scalars(
                select(ModelingDeploymentSwitch).where(
                    ModelingDeploymentSwitch.deployment_id == deployment
                )
            )
            assert switches.one().revision == 2
    finally:
        await _cleanup(database, pipeline_id)
