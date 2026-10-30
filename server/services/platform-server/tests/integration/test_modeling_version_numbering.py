"""训练与规则版本共享流水线编号，并以真实行锁串行分配。"""

import asyncio
import uuid
from typing import Any

import pytest
from conftest import AppContext
from sqlalchemy import delete, event, select, text
from sqlalchemy.exc import DBAPIError
from unit.modeling_fakes import (
    DirectRunner,
    execution_of,
    linear_frame,
    linear_graph,
)

from lib.db import Database
from lib.utils.ids import uuid7
from platform_server.apps.modeling.crud import (
    deployment_crud,
    model_version_crud,
)
from platform_server.apps.modeling.errors import RunAlreadyPublished
from platform_server.apps.modeling.models import (
    ModelingDeployment,
    ModelingModelVersion,
    ModelingNodeRun,
    ModelingPipeline,
    ModelingRuleVersion,
    ModelingRun,
)
from platform_server.apps.modeling.schemas import (
    ModelDeploymentUpdateIn,
    ModelVersionCreateIn,
)
from platform_server.apps.modeling.services import (
    Actor,
    deployment_service,
    model_service,
)
from platform_server.apps.modeling.services.run_executor import execute_graph
from platform_server.settings import Settings

pytestmark = pytest.mark.requires_postgres


def _version_fields(
    pipeline_id: uuid.UUID, run_id: uuid.UUID
) -> dict[str, Any]:
    return {
        "id": uuid7(),
        "pipeline_id": pipeline_id,
        "run_id": run_id,
        "name": "能源模型",
        "servable": True,
        "serving_channel": "json",
        "serving_json": {},
        "signature_json": {},
        "feature_keys": ["输入"],
        "metrics_json": {},
        "fingerprint_json": {},
    }


async def _seed_runs(
    database: Database, pipeline_id: uuid.UUID
) -> list[uuid.UUID]:
    runs = [uuid7(), uuid7()]
    async with database.session() as session:
        session.add(
            ModelingPipeline(
                id=pipeline_id,
                code=f"number-{pipeline_id}",
                name="能源模型",
                graph_json={},
            )
        )
        await session.flush()
        for run_id in runs:
            session.add(
                ModelingRun(
                    id=run_id,
                    pipeline_id=pipeline_id,
                    status="succeeded",
                    trigger="manual",
                    graph_snapshot={},
                )
            )
    return runs


async def _competing_number(database: Database, pipeline_id: uuid.UUID) -> int:
    async with database.session() as session:
        await session.execute(text("SET LOCAL lock_timeout = '100ms'"))
        return await model_version_crud.next_version(session, pipeline_id)


async def _exercise_numbering(
    database: Database, pipeline_id: uuid.UUID
) -> int:
    runs = await _seed_runs(database, pipeline_id)
    async with database.session() as first:
        assert await model_version_crud.next_version(first, pipeline_id) == 1
        with pytest.raises(DBAPIError, match="lock timeout"):
            await _competing_number(database, pipeline_id)
        first.add(
            ModelingModelVersion(
                **_version_fields(pipeline_id, runs[0]),
                version=1,
                algo="linear_regression",
                task="regression",
                target_key="目标",
            )
        )
    async with database.session() as second:
        assert await model_version_crud.next_version(second, pipeline_id) == 2
        second.add(
            ModelingRuleVersion(
                **_version_fields(pipeline_id, runs[1]),
                version=2,
                algo="energy_rules",
                task="rule_calculation",
                target_key=None,
            )
        )
    async with database.session() as session:
        return await model_version_crud.next_version(session, pipeline_id)


async def test_version_numbers_are_serialized_across_both_model_stores(
    settings: Settings, app_context: AppContext
) -> None:
    del app_context
    database = Database(dsn=settings.dsn(), search_path="platform")
    pipeline_id = uuid7()
    try:
        assert await _exercise_numbering(database, pipeline_id) == 3
    finally:
        async with database.session() as session:
            for model in (ModelingModelVersion, ModelingRuleVersion):
                await session.execute(
                    delete(model).where(model.pipeline_id == pipeline_id)
                )
            await session.execute(
                delete(ModelingRun).where(
                    ModelingRun.pipeline_id == pipeline_id
                )
            )
            await session.execute(
                delete(ModelingPipeline).where(
                    ModelingPipeline.id == pipeline_id
                )
            )
        await database.dispose()


async def _seed_deployment(
    database: Database, pipeline_id: uuid.UUID
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    runs = await _seed_runs(database, pipeline_id)
    async with database.session() as session:
        trained = ModelingModelVersion(
            **_version_fields(pipeline_id, runs[0]),
            version=1,
            algo="linear_regression",
            task="regression",
            target_key="目标",
        )
        rules = ModelingRuleVersion(
            **_version_fields(pipeline_id, runs[1]),
            version=2,
            algo="energy_rules",
            task="rule_calculation",
            target_key=None,
        )
        session.add_all((trained, rules))
        await session.flush()
        deployment = ModelingDeployment(
            id=uuid7(),
            code=f"switch-{pipeline_id}",
            name="能源服务",
            model_version_id=trained.id,
        )
        session.add(deployment)
        await session.flush()
        return deployment.id, trained.id, rules.id


async def _blocked_deployment(
    database: Database, deployment_id: uuid.UUID
) -> None:
    async with database.session() as session:
        await session.execute(text("SET LOCAL lock_timeout = '100ms'"))
        await deployment_crud.get_for_update(session, deployment_id)


async def _exercise_switching(
    database: Database, pipeline_id: uuid.UUID
) -> tuple[uuid.UUID | None, uuid.UUID | None, uuid.UUID]:
    deployment_id, trained_id, rule_id = await _seed_deployment(
        database, pipeline_id
    )
    async with database.session() as stale:
        original = await deployment_crud.get(stale, deployment_id)
        assert original is not None
        assert original.model_version_id == trained_id
        async with database.session() as first:
            await deployment_service.update_deployment(
                first,
                deployment_id=deployment_id,
                payload=ModelDeploymentUpdateIn(model_version_id=rule_id),
            )
            with pytest.raises(DBAPIError, match="lock timeout"):
                await _blocked_deployment(database, deployment_id)
        await deployment_service.update_deployment(
            stale,
            deployment_id=deployment_id,
            payload=ModelDeploymentUpdateIn(model_version_id=trained_id),
        )
    async with database.session() as session:
        deployed = await deployment_crud.get(session, deployment_id)
        assert deployed is not None
        return deployed.model_version_id, deployed.rule_version_id, trained_id


async def _cleanup(database: Database, pipeline_id: uuid.UUID) -> None:
    async with database.session() as session:
        await session.execute(
            delete(ModelingDeployment).where(
                ModelingDeployment.code == f"switch-{pipeline_id}"
            )
        )
        for model in (ModelingModelVersion, ModelingRuleVersion):
            await session.execute(
                delete(model).where(model.pipeline_id == pipeline_id)
            )
        await session.execute(
            delete(ModelingRun).where(ModelingRun.pipeline_id == pipeline_id)
        )
        await session.execute(
            delete(ModelingPipeline).where(ModelingPipeline.id == pipeline_id)
        )
    await database.dispose()


async def test_cross_type_updates_refresh_cached_references_and_lock_deployment(
    settings: Settings, app_context: AppContext
) -> None:
    del app_context
    database = Database(dsn=settings.dsn(), search_path="platform")
    pipeline_id = uuid7()
    try:
        model_id, rule_id, expected = await _exercise_switching(
            database, pipeline_id
        )
        assert model_id == expected
        assert rule_id is None
    finally:
        await _cleanup(database, pipeline_id)


async def test_concurrent_retirement_does_not_break_version_pagination(
    settings: Settings, app_context: AppContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    del app_context
    database = Database(dsn=settings.dsn(), search_path="platform")
    pipeline_id = uuid7()
    try:
        await _exercise_numbering(database, pipeline_id)
        async with database.session() as session:
            original = session.scalars
            did_retire = False

            async def scalars(statement: Any, *args: Any, **kwargs: Any) -> Any:
                nonlocal did_retire
                result = await original(statement, *args, **kwargs)
                if not did_retire:
                    did_retire = True
                    async with database.session() as rival:
                        await rival.execute(
                            delete(ModelingRuleVersion).where(
                                ModelingRuleVersion.pipeline_id == pipeline_id
                            )
                        )
                return result

            monkeypatch.setattr(session, "scalars", scalars)
            rows, total = await model_version_crud.page(
                session, pipeline_id=pipeline_id, offset=0, limit=10
            )
            assert total == 2
            assert len(rows) == 1
            assert rows[0].task == "regression"
    finally:
        await _cleanup(database, pipeline_id)


async def _seed_trained_run(
    database: Database, pipeline_id: uuid.UUID
) -> uuid.UUID:
    run_id = (await _seed_runs(database, pipeline_id))[0]
    graph = linear_graph()
    outcome = await execute_graph(
        graph,
        execution=execution_of(DirectRunner(), frames={"s": linear_frame(48)}),
    )
    assert outcome.status == "succeeded"
    async with database.session() as session:
        run = await session.get(ModelingRun, run_id)
        assert run is not None
        run.graph_snapshot = graph.model_dump(mode="json")
        run.row_count = outcome.row_count
        for node in outcome.nodes:
            session.add(
                ModelingNodeRun(
                    run_id=run_id,
                    node_id=node.node_id,
                    operator=node.operator,
                    ordinal=node.ordinal,
                    status=node.status,
                    preview_json=node.preview,
                    fitted_json=node.fitted,
                    io_json=node.io,
                )
            )
    return run_id


async def _publish(database: Database, run_id: uuid.UUID) -> None:
    async with database.session() as session:
        await model_service.publish_version(
            session,
            payload=ModelVersionCreateIn(run_id=run_id, name="能源模型"),
            actor=Actor(user_id="test", name="测试员"),
        )


async def test_concurrent_publication_of_one_run_returns_domain_conflict(
    settings: Settings, app_context: AppContext
) -> None:
    del app_context
    database = Database(dsn=settings.dsn(), search_path="platform")
    pipeline_id = uuid7()
    reached_lock = asyncio.Event()
    engine = database.engine.sync_engine
    competing: asyncio.Task[None] | None = None

    def observe(**details: Any) -> None:
        statement = details["statement"]
        if "modeling_pipelines" in statement and "FOR UPDATE" in statement:
            reached_lock.set()

    try:
        run_id = await _seed_trained_run(database, pipeline_id)
        async with database.session() as first:
            await first.execute(
                select(ModelingPipeline.id)
                .where(ModelingPipeline.id == pipeline_id)
                .with_for_update()
            )
            await model_service.publish_version(
                first,
                payload=ModelVersionCreateIn(run_id=run_id, name="首次发布"),
                actor=Actor(user_id="test", name="测试员"),
            )
            event.listen(engine, "before_cursor_execute", observe, named=True)
            competing = asyncio.create_task(_publish(database, run_id))
            await asyncio.wait_for(reached_lock.wait(), timeout=5)
        with pytest.raises(RunAlreadyPublished) as caught:
            await asyncio.wait_for(competing, timeout=5)
        assert caught.value.http_status == 409
    finally:
        if event.contains(engine, "before_cursor_execute", observe):
            event.remove(engine, "before_cursor_execute", observe)
        if competing is not None and not competing.done():
            competing.cancel()
            await asyncio.gather(competing, return_exceptions=True)
        await _cleanup(database, pipeline_id)
