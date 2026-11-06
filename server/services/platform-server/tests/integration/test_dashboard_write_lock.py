"""同一张大屏的写操作在真实双事务里串行：后到者看见先到者提交的结果。

⚠ 等第二个事务真的排到第一个后面才提交：不等的话它可能在提交之后才开读，修复前
后都绿，用例就白写了。
"""

import asyncio
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass

import pytest
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import Database, PoolProfile
from platform_server.apps.dashboard.errors import (
    NodeNotFound,
    VersionConflict,
)
from platform_server.apps.dashboard.models import (
    Dashboard,
    DashboardNode,
    DashboardProject,
)
from platform_server.apps.dashboard.schemas import (
    NodeCreateIn,
    NodeOut,
    NodeUpdateIn,
    ReplaceLayoutIn,
)
from platform_server.apps.dashboard.services import (
    load_module_catalog,
    node_service,
)
from platform_server.apps.dashboard.services.layout_service import (
    replace_layout,
)
from platform_server.apps.dashboard.services.point_catalog import (
    StaticPointCatalog,
)
from platform_server.apps.dashboard.services.validation import (
    ValidationContext,
)

pytestmark = pytest.mark.requires_postgres

# ⚠ 手工建库，CI 放宽语句超时的环境变量管不到；互斥用例不判耗时，放宽预算
WAIT_BUDGET_S = 30
WAIT_PROFILE = PoolProfile(
    statement_timeout_ms=WAIT_BUDGET_S * 1000,
    lock_timeout_ms=WAIT_BUDGET_S * 1000,
)
CONTEXT = ValidationContext(
    catalog=load_module_catalog(), points=StaticPointCatalog()
)
NODE = {"module_type": "header", "x": 0, "y": 0, "w": 10, "h": 10}


@dataclass(frozen=True)
class Screen:
    """提交到独立事务、供并发写的一张空大屏。"""

    database: Database
    project_id: uuid.UUID
    dashboard_id: uuid.UUID


@pytest.fixture
async def screen(db_session: AsyncSession) -> AsyncIterator[Screen]:
    database = Database(
        dsn=db_session.get_bind().engine.url.render_as_string(
            hide_password=False
        ),
        profile=WAIT_PROFILE,
        search_path="platform",
    )
    async with database.session() as session:
        project = DashboardProject(name=f"并发{uuid.uuid4().hex}")
        session.add(project)
        await session.flush()
        dashboard = Dashboard(project_id=project.id, name="主屏")
        session.add(dashboard)
        await session.flush()
        case = Screen(database, project.id, dashboard.id)
    try:
        yield case
    finally:
        async with database.session() as session:
            await session.execute(
                delete(Dashboard).where(Dashboard.id == case.dashboard_id)
            )
            await session.execute(
                delete(DashboardProject).where(
                    DashboardProject.id == case.project_id
                )
            )
        await database.dispose()


def layout(version: int, node_id: uuid.UUID) -> ReplaceLayoutIn:
    """只有一个节点的替换。

    Args: version, node_id。
    """
    return ReplaceLayoutIn.model_validate(
        {
            "expected_version": version,
            "nodes": [{**NODE, "id": str(node_id)}],
        }
    )


async def save(case: Screen, payload: ReplaceLayoutIn) -> None:
    """在独立事务里发一次整树替换。

    Args: case, payload。
    """
    async with case.database.session() as session:
        await replace_layout(
            session,
            dashboard_id=case.dashboard_id,
            payload=payload,
            context=CONTEXT,
        )


async def add_node(case: Screen) -> NodeOut:
    """在独立事务里加一个节点。Args: case。"""
    async with case.database.session() as session:
        return await node_service.create_node(
            session,
            dashboard_id=case.dashboard_id,
            payload=NodeCreateIn.model_validate(NODE),
            context=CONTEXT,
        )


async def stored(case: Screen) -> tuple[int, list[uuid.UUID]]:
    """库里现在的版本号与节点 id。Args: case。"""
    async with case.database.session() as session:
        version = await session.execute(
            select(Dashboard.row_version).where(
                Dashboard.id == case.dashboard_id
            )
        )
        nodes = await session.execute(
            select(DashboardNode.id).where(
                DashboardNode.dashboard_id == case.dashboard_id
            )
        )
        return version.scalar_one(), list(nodes.scalars().all())


async def queued_behind(case: Screen, holder: AsyncSession) -> None:
    """等到有别的连接被 `holder` 的事务挡住。

    Args: case, holder。
    """
    process_id = await holder.scalar(text("SELECT pg_backend_pid()"))
    async with asyncio.timeout(WAIT_BUDGET_S), case.database.session() as peer:
        is_queued = False
        while not is_queued:
            is_queued = bool(
                await peer.scalar(
                    text(
                        "SELECT count(*) > 0 FROM pg_stat_activity "
                        "WHERE :process_id = ANY(pg_blocking_pids(pid))"
                    ),
                    {"process_id": process_id},
                )
            )


async def test_the_later_of_two_saves_on_one_version_gets_a_conflict(
    screen: Screen,
) -> None:
    winner = uuid.uuid4()
    async with screen.database.session() as session:
        await replace_layout(
            session,
            dashboard_id=screen.dashboard_id,
            payload=layout(1, winner),
            context=CONTEXT,
        )
        later = asyncio.create_task(save(screen, layout(1, uuid.uuid4())))
        await queued_behind(screen, session)

    with pytest.raises(VersionConflict):
        await later
    assert await stored(screen) == (2, [winner])


async def test_two_single_writes_both_advance_the_version(
    screen: Screen,
) -> None:
    async with screen.database.session() as session:
        await node_service.create_node(
            session,
            dashboard_id=screen.dashboard_id,
            payload=NodeCreateIn.model_validate(NODE),
            context=CONTEXT,
        )
        later = asyncio.create_task(add_node(screen))
        await queued_behind(screen, session)

    await later
    version, nodes = await stored(screen)
    assert (version, len(nodes)) == (3, 2)


async def test_a_node_write_queued_behind_a_delete_answers_404(
    screen: Screen,
) -> None:
    created = await add_node(screen)
    async with screen.database.session() as session:
        await replace_layout(
            session,
            dashboard_id=screen.dashboard_id,
            payload=layout(2, uuid.uuid4()),
            context=CONTEXT,
        )
        later = asyncio.create_task(_touch(screen, created.id))
        await queued_behind(screen, session)

    with pytest.raises(NodeNotFound):
        await later


async def _touch(case: Screen, node_id: uuid.UUID) -> None:
    async with case.database.session() as session:
        await node_service.update_node(
            session,
            node_id=node_id,
            payload=NodeUpdateIn(z_index=1),
            context=CONTEXT,
        )
