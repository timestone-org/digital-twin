"""真实独立连接下训练消息原子认领和健康执行去重。"""

import asyncio
import uuid

from conftest import AppContext
from sqlalchemy import delete

from lib.db import Database
from lib.utils.ids import uuid7
from platform_server.apps.modeling.models import ModelingPipeline, ModelingRun
from platform_server.apps.modeling.services.run_dispatch import RUN_BUSY, _claim
from platform_server.settings import Settings


async def _seed(database: Database, identity: uuid.UUID) -> uuid.UUID:
    async with database.session() as session:
        session.add(
            ModelingPipeline(
                id=identity,
                code=f"claim-{identity}",
                name="认领测试",
                graph_json={},
            )
        )
        await session.flush()
        run = ModelingRun(
            pipeline_id=identity,
            status="pending",
            trigger="manual",
            graph_snapshot={},
        )
        session.add(run)
        await session.flush()
        return run.id


async def _cleanup(database: Database, identity: uuid.UUID) -> None:
    async with database.session() as session:
        await session.execute(
            delete(ModelingRun).where(ModelingRun.pipeline_id == identity)
        )
        await session.execute(
            delete(ModelingPipeline).where(ModelingPipeline.id == identity)
        )
    await database.dispose()


async def test_healthy_training_ignores_a_second_message(
    settings: Settings,
    app_context: AppContext,
) -> None:
    del app_context
    database = Database(dsn=settings.dsn(), search_path="platform")
    identity = uuid7()
    try:
        run_id = await _seed(database, identity)
        claimed = await _claim(database, run_id)
        assert claimed is not None
        assert not isinstance(claimed, str)
        assert claimed.is_redelivery is False
        assert await _claim(database, run_id) == RUN_BUSY
        async with database.session() as session:
            run = await session.get(ModelingRun, run_id)
            assert run is not None
            assert run.status == "running"
            assert run.attempt == 1
    finally:
        await _cleanup(database, identity)


async def test_two_workers_atomically_claim_the_same_pending_training(
    settings: Settings,
    app_context: AppContext,
) -> None:
    del app_context
    database = Database(dsn=settings.dsn(), search_path="platform")
    identity = uuid7()
    try:
        run_id = await _seed(database, identity)
        results = await asyncio.gather(
            _claim(database, run_id), _claim(database, run_id)
        )
        assert (
            len(
                [
                    item
                    for item in results
                    if item != RUN_BUSY and item is not None
                ]
            )
            == 1
        )
        async with database.session() as session:
            run = await session.get(ModelingRun, run_id)
            assert run is not None
            assert run.status == "running"
            assert run.attempt == 1
    finally:
        await _cleanup(database, identity)
