"""哪些大屏绑着某个点位 —— 采集配置面删点位前要问的那件事。

⚠ 这条查询正是「配置面必须留在 platform」的理由（ADR-0001 理由一）：绑定表
在这个库里。配置面跟着采集运行时走，就要为每次删除反向 RPC 回来问，形成双向
依赖——分布式死锁与级联超时的标准配方。
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.dashboard.models import (
    Dashboard,
    DashboardBinding,
    DashboardNode,
)


@dataclass(frozen=True)
class BoundDashboard:
    """一张绑着某个点位的大屏。"""

    dashboard_id: uuid.UUID
    dashboard_name: str
    binding_count: int


async def dashboards_binding(
    session: AsyncSession, node_keys: Sequence[str]
) -> dict[str, list[BoundDashboard]]:
    """给一批 `node_key`，回每个被哪些大屏绑着。

    顺序按 `(大屏名, 大屏 id)` 写死：同一次询问两次调用要给出同一份清单，
    否则错误信息里的大屏顺序会来回跳。
    Args: session, node_keys。
    """
    if not node_keys:
        return {}
    rows = await session.execute(
        select(DashboardBinding.node_key, Dashboard.id, Dashboard.name)
        .join(DashboardNode, DashboardBinding.node_id == DashboardNode.id)
        .join(Dashboard, DashboardNode.dashboard_id == Dashboard.id)
        .where(DashboardBinding.node_key.in_(list(node_keys)))
        .order_by(Dashboard.name.asc(), Dashboard.id.asc())
    )
    counted: dict[str, dict[uuid.UUID, BoundDashboard]] = {}
    for node_key, dashboard_id, name in rows.all():
        found = counted.setdefault(str(node_key), {})
        seen = found.get(dashboard_id)
        found[dashboard_id] = BoundDashboard(
            dashboard_id=dashboard_id,
            dashboard_name=str(name),
            binding_count=1 if seen is None else seen.binding_count + 1,
        )
    return {key: list(value.values()) for key, value in counted.items()}
