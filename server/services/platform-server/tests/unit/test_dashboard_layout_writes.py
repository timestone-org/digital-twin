"""整树替换的落库顺序：最终形态合法的保存，中间态不许撞外键或唯一约束。

⚠ 同一次 flush 里 SQLAlchemy 先 UPDATE 后 INSERT，而自引用外键非延迟；绑定的
节点外键又带级联。写入顺序一错，要么合法保存被报成 409，要么绑定被数据库带走。
"""

import uuid
from collections.abc import AsyncIterator
from typing import Any

import pytest
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from platform_server.apps.dashboard.errors import VersionConflict
from platform_server.apps.dashboard.models import (
    Dashboard,
    DashboardBinding,
    DashboardNode,
)
from platform_server.apps.dashboard.schemas import ReplaceLayoutIn
from platform_server.apps.dashboard.services.layout_service import (
    replace_layout,
)
from unit.dashboard_sqlite import (
    CONTEXT,
    open_engine,
    seed_binding,
    seed_dashboard,
    seed_node,
)


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    async for opened in open_engine():
        yield opened


@pytest.fixture
async def session(engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    async with AsyncSession(engine, expire_on_commit=False) as opened:
        yield opened


def entry(
    node_id: uuid.UUID,
    *,
    parent_id: uuid.UUID | None = None,
    client_key: str | None = None,
    bindings: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """一个替换条目。

    Args: node_id, parent_id, client_key, bindings。
    """
    return {
        "id": str(node_id),
        "parent_id": None if parent_id is None else str(parent_id),
        "client_key": client_key,
        "module_type": "twin-view",
        "x": 0,
        "y": 0,
        "w": 100,
        "h": 100,
        "bindings": bindings or [],
    }


def static_binding(binding_id: uuid.UUID, index: int = 0) -> dict[str, Any]:
    """一条钉了 id 的静态绑定。

    Args: binding_id, index。
    """
    return {
        "id": str(binding_id),
        "field_key": f"anchorValues[{index}].value",
        "source_kind": "static",
        "static_value_json": 1,
    }


async def replace(
    session: AsyncSession, dashboard: Dashboard, nodes: list[dict[str, Any]]
) -> None:
    """按当前版本发一次整树替换。

    Args: session, dashboard, nodes。
    """
    await replace_layout(
        session,
        dashboard_id=dashboard.id,
        payload=ReplaceLayoutIn.model_validate(
            {"expected_version": dashboard.row_version, "nodes": nodes}
        ),
        context=CONTEXT,
    )


async def parent_of(
    session: AsyncSession, node_id: uuid.UUID
) -> uuid.UUID | None:
    """从库里现读节点的父节点。Args: session, node_id。"""
    rows = await session.execute(
        select(DashboardNode.parent_id).where(DashboardNode.id == node_id)
    )
    return rows.scalar_one()


async def node_of_binding(
    session: AsyncSession, binding_id: uuid.UUID
) -> uuid.UUID | None:
    """从库里现读绑定挂在哪个节点上。Args: session, binding_id。"""
    rows = await session.execute(
        select(DashboardBinding.node_id).where(
            DashboardBinding.id == binding_id
        )
    )
    return rows.scalar_one_or_none()


async def test_an_existing_node_can_move_under_a_container_born_this_save(
    session: AsyncSession,
) -> None:
    dashboard = await seed_dashboard(session)
    existing = await seed_node(session, dashboard)
    container = uuid.uuid4()

    await replace(
        session,
        dashboard,
        [entry(existing.id, parent_id=container), entry(container)],
    )

    assert await parent_of(session, existing.id) == container


async def test_a_new_node_can_take_a_key_an_existing_node_just_gave_up(
    session: AsyncSession,
) -> None:
    dashboard = await seed_dashboard(session)
    existing = await seed_node(session, dashboard, client_key="old")
    newcomer = uuid.uuid4()

    await replace(
        session,
        dashboard,
        [
            entry(existing.id, client_key="renamed"),
            entry(newcomer, client_key="old"),
        ],
    )

    keys = await session.execute(
        select(DashboardNode.id).where(DashboardNode.client_key == "old")
    )
    assert keys.scalar_one() == newcomer


async def test_a_new_node_can_take_the_key_of_a_node_deleted_this_save(
    session: AsyncSession,
) -> None:
    dashboard = await seed_dashboard(session)
    await seed_node(session, dashboard, client_key="slot")
    newcomer = uuid.uuid4()

    await replace(session, dashboard, [entry(newcomer, client_key="slot")])

    rows = await session.execute(select(DashboardNode.id))
    assert rows.scalars().all() == [newcomer]


async def test_a_binding_survives_its_node_being_deleted_in_the_same_save(
    session: AsyncSession,
) -> None:
    dashboard = await seed_dashboard(session)
    doomed = await seed_node(session, dashboard)
    keeper = await seed_node(session, dashboard)
    binding = await seed_binding(session, doomed)

    await replace(
        session,
        dashboard,
        [entry(keeper.id, bindings=[static_binding(binding.id)])],
    )

    assert await node_of_binding(session, binding.id) == keeper.id


async def test_several_bindings_survive_moving_to_a_node_born_this_save(
    session: AsyncSession,
) -> None:
    # ⚠ 多条走 executemany，asyncpg 不校验影响行数，丢绑定时连错都不报
    dashboard = await seed_dashboard(session)
    doomed = await seed_node(session, dashboard)
    first = await seed_binding(session, doomed, index=0)
    second = await seed_binding(session, doomed, index=1)
    newcomer = uuid.uuid4()

    await replace(
        session,
        dashboard,
        [
            entry(
                newcomer,
                bindings=[
                    static_binding(first.id, 0),
                    static_binding(second.id, 1),
                ],
            )
        ],
    )

    assert await node_of_binding(session, first.id) == newcomer
    assert await node_of_binding(session, second.id) == newcomer


async def test_a_binding_left_out_goes_with_its_deleted_node(
    session: AsyncSession,
) -> None:
    dashboard = await seed_dashboard(session)
    doomed = await seed_node(session, dashboard)
    binding = await seed_binding(session, doomed)
    keeper = await seed_node(session, dashboard)

    await replace(session, dashboard, [entry(keeper.id)])

    assert await node_of_binding(session, binding.id) is None


async def test_a_kept_child_outlives_its_deleted_parent(
    session: AsyncSession,
) -> None:
    dashboard = await seed_dashboard(session)
    doomed = await seed_node(session, dashboard)
    child = await seed_node(session, dashboard, parent_id=doomed.id)

    await replace(session, dashboard, [entry(child.id)])

    rows = await session.execute(select(DashboardNode.id))
    assert rows.scalars().all() == [child.id]


async def test_the_version_is_judged_from_the_row_not_from_the_session(
    session: AsyncSession,
) -> None:
    # 别的事务抢先提交后，身份映射里还是旧版本号；比它就等于没比
    dashboard = await seed_dashboard(session)
    version = dashboard.row_version
    await session.execute(
        update(Dashboard)
        .where(Dashboard.id == dashboard.id)
        .values(row_version=version + 1),
        execution_options={"synchronize_session": False},
    )

    with pytest.raises(VersionConflict):
        await replace_layout(
            session,
            dashboard_id=dashboard.id,
            payload=ReplaceLayoutIn(expected_version=version, nodes=[]),
            context=CONTEXT,
        )
