"""推进 `row_version` 的写路径都要先锁大屏行，且实体在锁后才载入。

⚠ 这里核对的是语句形状；两个事务真实互斥的行为由
`integration/test_dashboard_write_lock.py` 打真库验证。
"""

import uuid
from collections.abc import AsyncIterator, Awaitable, Callable

import pytest
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from platform_server.apps.dashboard.errors import (
    BindingNotFound,
    DashboardNotFound,
    NodeNotFound,
)
from platform_server.apps.dashboard.models import Dashboard, DashboardNode
from platform_server.apps.dashboard.schemas import (
    BindingCreateIn,
    BindingUpdateIn,
    DashboardUpdateIn,
    NodeCreateIn,
    NodeUpdateIn,
)
from platform_server.apps.dashboard.schemas.transfer import DashboardExportIn
from platform_server.apps.dashboard.services import (
    binding_service,
    dashboard_service,
    node_service,
    transfer_service,
)
from platform_server.apps.dashboard.services.state import load_state
from unit.dashboard_sqlite import (
    CONTEXT,
    StatementLog,
    open_engine,
    seed_binding,
    seed_dashboard,
    seed_node,
)

Write = Callable[[AsyncSession, Dashboard, DashboardNode], Awaitable[object]]
MISSING = uuid.UUID("0198f0c0-0000-7000-8000-00000000dead")


@pytest.fixture
async def engine() -> AsyncIterator[AsyncEngine]:
    async for opened in open_engine():
        yield opened


@pytest.fixture
async def session(engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    async with AsyncSession(engine, expire_on_commit=False) as opened:
        yield opened


async def _update_dashboard(
    session: AsyncSession, dashboard: Dashboard, _node: DashboardNode
) -> object:
    return await dashboard_service.update_dashboard(
        session,
        dashboard_id=dashboard.id,
        payload=DashboardUpdateIn(name="改名"),
    )


async def _create_node(
    session: AsyncSession, dashboard: Dashboard, _node: DashboardNode
) -> object:
    return await node_service.create_node(
        session,
        dashboard_id=dashboard.id,
        payload=NodeCreateIn.model_validate(
            {"module_type": "header", "x": 0, "y": 0, "w": 10, "h": 10}
        ),
        context=CONTEXT,
    )


async def _update_node(
    session: AsyncSession, _dashboard: Dashboard, node: DashboardNode
) -> object:
    return await node_service.update_node(
        session,
        node_id=node.id,
        payload=NodeUpdateIn(z_index=3),
        context=CONTEXT,
    )


async def _delete_node(
    session: AsyncSession, _dashboard: Dashboard, node: DashboardNode
) -> object:
    await node_service.delete_node(session, node_id=node.id)
    return None


async def _create_binding(
    session: AsyncSession, _dashboard: Dashboard, node: DashboardNode
) -> object:
    return await binding_service.create_binding(
        session,
        node_id=node.id,
        payload=BindingCreateIn(
            field_key="anchorValues[1].value",
            source_kind="static",
            static_value_json=2,
        ),
        context=CONTEXT,
    )


async def _update_binding(
    session: AsyncSession, _dashboard: Dashboard, node: DashboardNode
) -> object:
    binding = await _binding_id_of(session, node)
    return await binding_service.update_binding(
        session,
        binding_id=binding,
        payload=BindingUpdateIn(static_value_json=5),
        context=CONTEXT,
    )


async def _delete_binding(
    session: AsyncSession, _dashboard: Dashboard, node: DashboardNode
) -> object:
    binding = await _binding_id_of(session, node)
    await binding_service.delete_binding(session, binding_id=binding)
    return None


async def _binding_id_of(
    session: AsyncSession, node: DashboardNode
) -> uuid.UUID:
    state = await load_state(session, node.dashboard_id)
    session.expunge_all()
    return state.bindings_of(node.id)[0].id


async def _import_over(
    session: AsyncSession, dashboard: Dashboard, _node: DashboardNode
) -> object:
    document = await transfer_service.export_dashboard(
        session, dashboard_id=dashboard.id
    )
    session.expunge_all()
    return await transfer_service.import_dashboard(
        session,
        project_id=dashboard.project_id,
        payload=DashboardExportIn.model_validate(document.model_dump()),
        context=CONTEXT,
        target_dashboard_id=dashboard.id,
    )


@pytest.mark.parametrize(
    "write",
    [
        _update_dashboard,
        _create_node,
        _update_node,
        _delete_node,
        _create_binding,
        _update_binding,
        _delete_binding,
        _import_over,
    ],
)
async def test_every_versioned_write_locks_the_dashboard_row(
    session: AsyncSession, write: Write
) -> None:
    dashboard = await seed_dashboard(session)
    node = await seed_node(session, dashboard)
    await seed_binding(session, node)
    log = StatementLog()
    log.attach(session)

    await write(session, dashboard, node)

    assert log.first_lock_at() is not None


async def test_a_node_is_loaded_only_after_its_dashboard_is_locked(
    session: AsyncSession,
) -> None:
    # 先载入再上锁的话，身份映射里留的是别的事务提交之前的旧值
    dashboard = await seed_dashboard(session)
    node = await seed_node(session, dashboard)
    session.expunge_all()
    log = StatementLog()
    log.attach(session)

    await node_service.update_node(
        session,
        node_id=node.id,
        payload=NodeUpdateIn(z_index=3),
        context=CONTEXT,
    )

    lock_at = log.first_lock_at()
    assert lock_at is not None
    assert not any(
        "dashboard_nodes.module_type" in statement
        for statement in log.statements[:lock_at]
    )


async def test_a_missing_dashboard_still_answers_404(
    session: AsyncSession,
) -> None:
    with pytest.raises(DashboardNotFound):
        await dashboard_service.locked_dashboard(session, MISSING)


async def test_a_missing_node_still_answers_404(
    session: AsyncSession,
) -> None:
    with pytest.raises(NodeNotFound):
        await node_service.delete_node(session, node_id=MISSING)


async def test_a_missing_binding_still_answers_404(
    session: AsyncSession,
) -> None:
    with pytest.raises(BindingNotFound):
        await binding_service.delete_binding(session, binding_id=MISSING)
