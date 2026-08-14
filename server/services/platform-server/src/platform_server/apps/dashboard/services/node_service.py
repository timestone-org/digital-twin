"""逐节点的写入面。与整树替换共用同一套校验与同一套 id 保持逻辑。"""

import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import get_logger
from lib.utils.ids import uuid7
from platform_server.apps.dashboard.crud import node_crud
from platform_server.apps.dashboard.errors import (
    ClientKeyTaken,
    NodeNotFound,
)
from platform_server.apps.dashboard.models import DashboardNode
from platform_server.apps.dashboard.schemas import (
    NodeCreateIn,
    NodeOut,
    NodeUpdateIn,
)
from platform_server.apps.dashboard.services.changes import given_changes
from platform_server.apps.dashboard.services.dashboard_service import (
    bump_version,
    require_dashboard,
)
from platform_server.apps.dashboard.services.drafts import NodeDraft
from platform_server.apps.dashboard.services.presenters import to_node_out
from platform_server.apps.dashboard.services.state import (
    DashboardState,
    binding_drafts,
    load_state,
    node_drafts,
)
from platform_server.apps.dashboard.services.validation import (
    ValidationContext,
    collect_issues,
    raise_if_invalid,
)

_logger = get_logger("platform.dashboard.node")


async def list_nodes(
    session: AsyncSession, *, dashboard_id: uuid.UUID
) -> list[NodeOut]:
    """一张大屏的全部节点，顺序钉死在 `(parent_id, z_index, id)`。

    Args: session, dashboard_id。
    """
    dashboard = await require_dashboard(session, dashboard_id)
    state = await load_state(session, dashboard.id)
    return [
        to_node_out(node, bindings=state.bindings_of(node.id))
        for node in state.nodes
    ]


async def get_node(session: AsyncSession, node_id: uuid.UUID) -> NodeOut:
    """节点详情，连它的绑定一起给。

    Args: session, node_id。
    """
    node = await require_node(session, node_id)
    state = await load_state(session, node.dashboard_id)
    return to_node_out(node, bindings=state.bindings_of(node.id))


async def create_node(
    session: AsyncSession,
    *,
    dashboard_id: uuid.UUID,
    payload: NodeCreateIn,
    context: ValidationContext,
) -> NodeOut:
    """新增一个节点。校验过不了就 400 且指到字段，绝不静默降级。

    Args: session, dashboard_id, payload, context。
    """
    dashboard = await require_dashboard(session, dashboard_id)
    state = await load_state(session, dashboard.id)
    node = DashboardNode(
        id=uuid7(),
        dashboard_id=dashboard.id,
        parent_id=payload.parent_id,
        client_key=payload.client_key,
        module_type=payload.module_type,
        x_px=payload.x_px,
        y_px=payload.y_px,
        width_px=payload.width_px,
        height_px=payload.height_px,
        z_index=payload.z_index,
        is_visible=payload.is_visible,
        config_json=payload.config_json,
    )
    await _check(state=state, node=node, context=context)
    node_crud.add(session, node)
    bump_version(dashboard)
    await _flush(session)
    _logger.info("dashboard_node_created", "节点已创建", node_id=str(node.id))
    return to_node_out(node, bindings=[])


async def update_node(
    session: AsyncSession,
    *,
    node_id: uuid.UUID,
    payload: NodeUpdateIn,
    context: ValidationContext,
) -> NodeOut:
    """改节点。id 不变——它是实时推送与 Agent 寻址的关联键。

    Args: session, node_id, payload, context。
    """
    node = await require_node(session, node_id)
    dashboard = await require_dashboard(session, node.dashboard_id)
    state = await load_state(session, dashboard.id)
    node_crud.apply_changes(node, given_changes(payload))
    await _check(state=state, node=node, context=context)
    bump_version(dashboard)
    await _flush(session)
    _logger.info("dashboard_node_updated", "节点已更新", node_id=str(node.id))
    return to_node_out(node, bindings=state.bindings_of(node.id))


async def delete_node(session: AsyncSession, *, node_id: uuid.UUID) -> None:
    """删节点，连它的子树——子树由数据库的级联外键带走。

    Args: session, node_id。
    """
    node = await require_node(session, node_id)
    dashboard = await require_dashboard(session, node.dashboard_id)
    bump_version(dashboard)
    _logger.info("dashboard_node_deleted", "节点已删除", node_id=str(node.id))
    await node_crud.delete(session, node)


async def require_node(
    session: AsyncSession, node_id: uuid.UUID
) -> DashboardNode:
    """取节点，取不到即 404。

    Args: session, node_id。
    """
    node = await node_crud.get(session, node_id)
    if node is None:
        raise NodeNotFound("画布节点不存在")
    return node


async def _check(
    *,
    state: DashboardState,
    node: DashboardNode,
    context: ValidationContext,
) -> None:
    """把改动后的整棵树过一遍校验。

    ⚠ 该节点已有的绑定要一起带上：改 `module_type` 会让原来合法的槽键当场
    悬空，不带上就成了「改类型静默留下一批永不产数据的绑定」。
    Args: state, node, context。
    """
    draft = NodeDraft(
        node_id=node.id,
        parent_id=node.parent_id,
        client_key=node.client_key,
        module_type=node.module_type,
        field_path="",
    )
    raise_if_invalid(
        await collect_issues(
            nodes=node_drafts(state.nodes, replaced=draft),
            bindings=binding_drafts(state.bindings_of(node.id)),
            context=context,
        )
    )


async def _flush(session: AsyncSession) -> None:
    try:
        await session.flush()
    except IntegrityError as error:
        raise ClientKeyTaken("同一张大屏里已有这个 client_key") from error
