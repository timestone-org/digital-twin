"""整树替换：编辑器一次保存走它。

它是**批量写入面**，不是更宽松的写入面——与逐节点端点共用同一套校验，否则
「先用批量接口写进去、再用单条接口读出来」就是绕过校验的后门（ADR-0012 三）。
"""

import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import get_logger
from platform_server.apps.dashboard.crud import binding_crud, node_crud
from platform_server.apps.dashboard.errors import ClientKeyTaken
from platform_server.apps.dashboard.models import (
    Dashboard,
    DashboardBinding,
    DashboardNode,
)
from platform_server.apps.dashboard.schemas import (
    DashboardOut,
    ReplaceLayoutIn,
)
from platform_server.apps.dashboard.services.dashboard_service import (
    bump_version,
    locked_dashboard,
    present_dashboard,
    require_version,
)
from platform_server.apps.dashboard.services.layout_plan import (
    LayoutPlan,
    binding_values,
    build_plan,
    in_parent_first_order,
    node_values,
)
from platform_server.apps.dashboard.services.state import (
    DashboardState,
    load_state,
)
from platform_server.apps.dashboard.services.validation import (
    ValidationContext,
    collect_issues,
    raise_if_invalid,
)

_logger = get_logger("platform.dashboard.layout")


async def replace_layout(
    session: AsyncSession,
    *,
    dashboard_id: uuid.UUID,
    payload: ReplaceLayoutIn,
    context: ValidationContext,
) -> DashboardOut:
    """整棵树替换。版本不符即 409，校验不过即 400。

    ⚠ 要删的节点排到最后才删：绑定的外键带级联，节点先走的话，同一次替换里要
    换到别的节点上的绑定会被数据库一起带走，而会话里的对象还以为它们在。
    Args: session, dashboard_id, payload, context。
    """
    dashboard = await locked_dashboard(session, dashboard_id)
    require_version(dashboard, payload.expected_version)
    state = await load_state(session, dashboard.id)
    plan = build_plan(payload)
    raise_if_invalid(
        await collect_issues(
            nodes=plan.node_drafts(),
            bindings=plan.binding_drafts(),
            context=context,
        )
    )
    doomed = await _vacate_removed(session, state=state, plan=plan)
    await _write_nodes(session, dashboard=dashboard, state=state, plan=plan)
    await _park_moved_bindings(session, state=state, plan=plan)
    _write_bindings(session, state=state, plan=plan)
    await _flush(session)
    await node_crud.delete_by_ids(session, doomed)
    if payload.schema_version is not None:
        dashboard.schema_version = payload.schema_version
    bump_version(dashboard)
    await _flush(session)
    _logger.info(
        "dashboard_layout_replaced",
        "整树已替换",
        dashboard_id=str(dashboard.id),
        node_count=len(plan.nodes),
    )
    return await present_dashboard(session, dashboard)


async def _vacate_removed(
    session: AsyncSession, *, state: DashboardState, plan: LayoutPlan
) -> list[uuid.UUID]:
    """删掉这次没出现的绑定，让要删的节点腾出占位，返回这批节点的 id。

    ⚠ 留下来的节点先从要删的父节点上摘下来，否则最后删节点时级联外键会把它们
    一起带走。
    ⚠ `client_key` 要在此腾出：节点排到最后才删，而新节点可以接它的键。
    Args: session, state, plan。
    """
    kept_nodes = plan.node_ids()
    doomed = {node.id for node in state.nodes if node.id not in kept_nodes}
    for node in state.nodes:
        if node.id in doomed:
            node.client_key = None
        elif node.parent_id in doomed:
            node.parent_id = None
    await _flush(session)
    kept_bindings = plan.binding_ids()
    await binding_crud.delete_by_ids(
        session,
        sorted(
            item.id for item in state.bindings if item.id not in kept_bindings
        ),
    )
    return sorted(doomed)


async def _park_moved_bindings(
    session: AsyncSession, *, state: DashboardState, plan: LayoutPlan
) -> None:
    """要换槽的绑定先挪到临时键上，让最终写入各就各位。

    ⚠ `(node_id, field_key)` 唯一且非延迟，而 flush 里 UPDATE 的先后由主键序
    决定：删一个数组行会让后面每一行的 fieldKey 前移一格，先更新的行会撞上
    还没让位的旧行；两行互换槽位更是怎么排序都撞。临时键带 `~` 前缀，合法
    槽键出不来这个形状，不会与任何最终键相撞。
    Args: session, state, plan。
    """
    known = {item.id: item for item in state.bindings}
    parked = False
    for planned in plan.nodes:
        for binding in planned.bindings:
            current = known.get(binding.binding_id)
            if current is None:
                continue
            if (
                current.field_key != binding.entry.field_key
                or current.node_id != binding.node_id
            ):
                current.field_key = f"~{current.id.hex}"
                parked = True
    if parked:
        await _flush(session)


async def _write_nodes(
    session: AsyncSession,
    *,
    dashboard: Dashboard,
    state: DashboardState,
    plan: LayoutPlan,
) -> None:
    """写节点，全部落盘后才轮到绑定：旧的改、新的插、再接旧节点的父子关系。

    ⚠ 三步各 flush 一次：同一次 flush 里 UPDATE 排在 INSERT 前面，旧节点要挂到
    新容器下就撞自引用外键；而旧节点又得先改完，新节点才接得住它让出的
    `client_key`，故父子关系单独放到最后。
    ⚠ 绑定不能混进这里：自引用外键让 SQLAlchemy 的表排序失效，同一次 flush 里
    绑定会抢在节点前面插。
    Args: session, dashboard, state, plan。
    """
    known = {node.id: node for node in state.nodes}
    for planned in plan.nodes:
        existing = known.get(planned.node_id)
        if existing is not None:
            values = node_values(planned.entry)
            del values["parent_id"]
            node_crud.apply_changes(existing, values)
    await _flush(session)
    for planned in in_parent_first_order(plan.nodes):
        if planned.node_id not in known:
            node_crud.add(
                session,
                DashboardNode(
                    id=planned.node_id,
                    dashboard_id=dashboard.id,
                    **node_values(planned.entry),
                ),
            )
    await _flush(session)
    for planned in plan.nodes:
        existing = known.get(planned.node_id)
        if existing is not None:
            existing.parent_id = planned.entry.parent_id
    await _flush(session)


def _write_bindings(
    session: AsyncSession, *, state: DashboardState, plan: LayoutPlan
) -> None:
    """写绑定：新的插、旧的改。

    Args: session, state, plan。
    """
    known = {item.id: item for item in state.bindings}
    for planned in plan.nodes:
        for binding in planned.bindings:
            # node_id 一起写：绑定可以在同一次替换里换到别的节点上
            values = {
                **binding_values(binding.entry),
                "node_id": binding.node_id,
            }
            current = known.get(binding.binding_id)
            if current is None:
                binding_crud.add(
                    session,
                    DashboardBinding(id=binding.binding_id, **values),
                )
            else:
                binding_crud.apply_changes(current, values)


async def _flush(session: AsyncSession) -> None:
    try:
        await session.flush()
    except IntegrityError as error:
        raise ClientKeyTaken("同一张大屏里 client_key 或绑定槽撞了") from error
