"""独立数据库连接下的部署修订与版本列表删除竞态。"""

import asyncio
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime

import pytest
from conftest import AppContext
from sqlalchemy import Subquery, delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from integration.test_modeling_version_numbering import (
    _cleanup,
    _seed_runs,
    _version_fields,
)
from lib.db import Database
from lib.utils.ids import uuid7
from lib.web import CursorPage
from platform_server.apps.modeling.crud import management_queries
from platform_server.apps.modeling.management_errors import (
    DeploymentRevisionConflict,
)
from platform_server.apps.modeling.models import (
    ModelingDeployment,
    ModelingModelVersion,
    ModelingRun,
    ModelVersion,
)
from platform_server.apps.modeling.models.deployment_switch import (
    ModelingDeploymentSwitch,
)
from platform_server.apps.modeling.schemas.management import (
    DeploymentSwitchIn,
    VersionListQuery,
)
from platform_server.apps.modeling.services import (
    management_queries as query_service,
)
from platform_server.apps.modeling.services.deployment_switch import (
    switch_deployment,
)
from platform_server.apps.modeling.services.pipeline_service import Actor
from platform_server.settings import Settings


async def seed_models(
    database: Database, pipeline: uuid.UUID
) -> tuple[uuid.UUID, list[uuid.UUID]]:
    runs = await _seed_runs(database, pipeline)
    async with database.session() as session:
        models = [
            ModelingModelVersion(
                **_version_fields(pipeline, run),
                version=number,
                algo="linear_regression",
                task="regression",
                target_key="目标",
            )
            for number, run in enumerate(runs, start=1)
        ]
        session.add_all(models)
        await session.flush()
        deployment = ModelingDeployment(
            code=f"switch-{pipeline}",
            name="并发服务",
            model_version_id=models[0].id,
        )
        session.add(deployment)
        await session.flush()
        return deployment.id, [model.id for model in models]


async def rival_switch(
    database: Database,
    identity: uuid.UUID,
    target: uuid.UUID,
    entered: asyncio.Event,
) -> None:
    async with database.session() as session:
        entered.set()
        await switch_deployment(
            session,
            identity,
            DeploymentSwitchIn(expected_revision=1, model_version_id=target),
            Actor(user_id="test", name="并发"),
        )


async def test_simultaneous_switches_only_one_expected_revision_succeeds(
    settings: Settings, app_context: AppContext
) -> None:
    del app_context
    database = Database(dsn=settings.dsn(), search_path="platform")
    pipeline = uuid7()
    try:
        identity, models = await seed_models(database, pipeline)
        entered = asyncio.Event()
        async with database.session() as first:
            await switch_deployment(
                first,
                identity,
                DeploymentSwitchIn(
                    expected_revision=1, model_version_id=models[1]
                ),
                Actor(user_id="test", name="首个"),
            )
            second = asyncio.create_task(
                rival_switch(database, identity, models[0], entered)
            )
            await entered.wait()
        with pytest.raises(DeploymentRevisionConflict):
            await second
        async with database.session() as read:
            row = await read.get(ModelingDeployment, identity)
            assert row is not None
            assert row.revision == 2
            assert row.model_version_id == models[1]
            history = list(
                await read.scalars(
                    select(ModelingDeploymentSwitch).where(
                        ModelingDeploymentSwitch.deployment_id == identity
                    )
                )
            )
            assert len(history) == 1
    finally:
        async with database.session() as session:
            await session.execute(
                delete(ModelingDeploymentSwitch).where(
                    ModelingDeploymentSwitch.deployment_code
                    == f"switch-{pipeline}"
                )
            )
        await _cleanup(database, pipeline)


async def test_retirement_preserves_cursor_lookahead(
    settings: Settings,
    app_context: AppContext,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del app_context
    database = Database(dsn=settings.dsn(), search_path="platform")
    pipeline = uuid7()
    try:
        models = await seed_three_versions(database, pipeline)
        reader = RetiringReader(
            database, models[-1], management_queries._version_rows
        )
        monkeypatch.setattr(management_queries, "_version_rows", reader)
        async with database.session() as read:
            first = await query_service.list_versions(
                read,
                VersionListQuery(
                    pipeline_id=pipeline, pagination="cursor", limit=1
                ),
            )
            assert isinstance(first, CursorPage)
            assert first.has_more is True
            assert first.items[0].id == models[1]
            second = await query_service.list_versions(
                read,
                VersionListQuery(
                    pipeline_id=pipeline,
                    pagination="cursor",
                    limit=1,
                    after=first.next,
                ),
            )
            assert isinstance(second, CursorPage)
            assert second.has_more is False
            assert second.items[0].id == models[0]
    finally:
        await _cleanup(database, pipeline)


async def seed_three_versions(
    database: Database, pipeline: uuid.UUID
) -> list[uuid.UUID]:
    runs = await _seed_runs(database, pipeline)
    async with database.session() as session:
        third = ModelingRun(
            pipeline_id=pipeline,
            status="succeeded",
            trigger="api",
            graph_snapshot={},
        )
        session.add(third)
        await session.flush()
        models = [
            ModelingModelVersion(
                **_version_fields(pipeline, run),
                version=number,
                created_at=datetime(2026, 10, 30, 0, number, tzinfo=UTC),
                algo="linear_regression",
                task="regression",
                target_key="目标",
            )
            for number, run in enumerate([*runs, third.id], start=1)
        ]
        session.add_all(models)
        await session.flush()
        return [model.id for model in models]


@dataclass
class RetiringReader:
    database: Database
    victim: uuid.UUID
    original: Callable[
        [AsyncSession, Subquery, VersionListQuery],
        Awaitable[list[ModelVersion]],
    ]
    is_removed: bool = False

    async def __call__(
        self, session: AsyncSession, selected: Subquery, query: VersionListQuery
    ) -> list[ModelVersion]:
        if not self.is_removed:
            self.is_removed = True
            async with self.database.session() as rival:
                await rival.execute(
                    delete(ModelingModelVersion).where(
                        ModelingModelVersion.id == self.victim
                    )
                )
        return await self.original(session, selected, query)
