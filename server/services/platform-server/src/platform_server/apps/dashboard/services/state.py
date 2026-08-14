"""一张大屏的当前状态：读节点与绑定、装成校验形态。"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.dashboard.crud import binding_crud, node_crud
from platform_server.apps.dashboard.models import (
    DashboardBinding,
    DashboardNode,
)
from platform_server.apps.dashboard.services.drafts import (
    BindingDraft,
    NodeDraft,
    binding_draft_of,
    node_draft_of,
)


@dataclass(frozen=True)
class DashboardState:
    """一张大屏已落库的节点与绑定，顺序已经排好。"""

    nodes: list[DashboardNode]
    bindings: list[DashboardBinding]

    def bindings_of(self, node_id: uuid.UUID) -> list[DashboardBinding]:
        """取某个节点的绑定，顺序沿用列表的 `(field_key, id)`。

        Args: node_id。
        """
        return [item for item in self.bindings if item.node_id == node_id]


async def load_state(
    session: AsyncSession, dashboard_id: uuid.UUID
) -> DashboardState:
    """读一张大屏的全部节点与绑定。

    Args: session, dashboard_id。
    """
    nodes = await node_crud.list_by_dashboard(session, dashboard_id)
    bindings = await binding_crud.list_by_nodes(
        session, [node.id for node in nodes]
    )
    return DashboardState(nodes=nodes, bindings=bindings)


def existing_node_path(node_id: uuid.UUID) -> str:
    """已落库节点在错误路径里的名字。

    Args: node_id。
    """
    return f"nodes[{node_id}]"


def existing_binding_path(binding_id: uuid.UUID) -> str:
    """已落库绑定在错误路径里的名字。

    Args: binding_id。
    """
    return f"bindings[{binding_id}]"


def node_drafts(
    nodes: Sequence[DashboardNode], *, replaced: NodeDraft | None = None
) -> list[NodeDraft]:
    """把已落库的节点装成校验形态，`replaced` 顶掉同 id 的那一个。

    Args: nodes, replaced。
    """
    drafts = [
        node_draft_of(node, field_path=existing_node_path(node.id))
        for node in nodes
        if replaced is None or node.id != replaced.node_id
    ]
    if replaced is not None:
        drafts.append(replaced)
    return drafts


def binding_drafts(
    bindings: Sequence[DashboardBinding],
    *,
    replaced: BindingDraft | None = None,
    dropped_id: uuid.UUID | None = None,
) -> list[BindingDraft]:
    """把已落库的绑定装成校验形态。

    Args: bindings, replaced（顶掉同 id 的那一条）, dropped_id。
    """
    drafts = [
        binding_draft_of(item, field_path=existing_binding_path(item.id))
        for item in bindings
        if item.id != dropped_id
    ]
    if replaced is not None:
        drafts.append(replaced)
    return drafts
