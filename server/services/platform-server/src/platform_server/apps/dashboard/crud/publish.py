"""发布循环要的三条查询：大屏清单、行版本、实时绑定的点位身份。

⚠ 都只读，且都不带整棵节点树：发布循环每一拍都会问一次行版本，而节点与配置
在那一拍里没有任何用处。
"""

import uuid
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.dashboard.models import (
    Dashboard,
    DashboardBinding,
    DashboardNode,
)
from platform_server.apps.dashboard.source_kinds import REALTIME_SOURCE_KIND


async def live_dashboard_ids(session: AsyncSession) -> list[uuid.UUID]:
    """全部大屏的 id，按 id 升序。主题对账拿它当权威。

    Args: session。
    """
    rows = await session.execute(select(Dashboard.id).order_by(Dashboard.id))
    return list(rows.scalars().all())


async def published_dashboards(
    session: AsyncSession,
) -> list[tuple[uuid.UUID, str]]:
    """仍在公开中的大屏及其当前令牌，按 id 升序。匿名授权对账拿它当权威。

    ⚠ 只取 `is_public` 且令牌非空的行：撤回把令牌置空，而对账的方向是「库里
    有什么，hub 上就该有什么」——多取一行就是一条撤不掉的公开授权。
    Args: session。
    """
    rows = await session.execute(
        select(Dashboard.id, Dashboard.public_token)
        .where(
            Dashboard.is_public.is_(True),
            Dashboard.public_token.is_not(None),
        )
        .order_by(Dashboard.id)
    )
    return [
        (row.id, row.public_token)
        for row in rows.all()
        if row.public_token is not None
    ]


async def versions_of(
    session: AsyncSession, dashboard_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, int]:
    """一批大屏当前的行版本。查不到的大屏不出现在结果里（已被删掉）。

    ⚠ 发布循环靠它判断绑定计划要不要重读：任何一次结构变更都会推进
    `row_version`，比「每拍重读整棵树」便宜得多。
    Args: session, dashboard_ids。
    """
    if not dashboard_ids:
        return {}
    rows = await session.execute(
        select(Dashboard.id, Dashboard.row_version).where(
            Dashboard.id.in_(list(dashboard_ids))
        )
    )
    return {row.id: row.row_version for row in rows.all()}


async def realtime_node_keys_of(
    session: AsyncSession, dashboard_id: uuid.UUID
) -> list[str]:
    """一张大屏上全部**实时**绑定指向的点位身份，去重后按身份升序。

    ⚠ 顺序钉死：条目顺序变来变去会让「这一拍与上一拍是否相同」的比较失效。
    Args: session, dashboard_id。
    """
    rows = await session.execute(
        select(DashboardBinding.node_key)
        .join(DashboardNode, DashboardBinding.node_id == DashboardNode.id)
        .where(
            DashboardNode.dashboard_id == dashboard_id,
            DashboardBinding.source_kind == REALTIME_SOURCE_KIND,
            DashboardBinding.node_key.is_not(None),
        )
        .distinct()
        .order_by(DashboardBinding.node_key)
    )
    return [node_key for node_key in rows.scalars().all() if node_key]
