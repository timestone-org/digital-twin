"""一张大屏的发布计划：它当前要推哪些点位，以及它的行版本。

⚠ 按 `row_version` 判断要不要重读：任何一次结构变更都会推进它（ADR-0012），
所以「版本没变就不必再读一遍绑定」是可靠的，而每拍重读整棵节点树不是。
"""

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import Database
from platform_server.apps.dashboard.crud import publish_crud


@dataclass(frozen=True)
class DashboardPlan:
    """一张大屏当前要推的点位，连同它的行版本。"""

    row_version: int
    node_keys: tuple[str, ...]


@dataclass(frozen=True)
class PlanLookup:
    """一次计划查询的结果。

    `plan` 为空表示这张大屏已经不在了；`is_reloaded` 为真表示绑定刚重读过，
    调用方据它决定要不要推一帧全量。
    """

    plan: DashboardPlan | None
    is_reloaded: bool


class PlanSource(Protocol):
    """发布计划的最小查询面。真实现打库，测试用进程内假件。

    ⚠ 只有批量这一个形状：发布循环每一拍都要问一遍全部在看的大屏，留一个
    单张的重载就会有人在循环里逐张调它。
    """

    async def load_many(
        self,
        dashboard_ids: Sequence[uuid.UUID],
        cached: Mapping[uuid.UUID, DashboardPlan],
    ) -> dict[uuid.UUID, PlanLookup]: ...


class DashboardIndex(Protocol):
    """大屏清单的最小查询面。主题对账拿它当权威。"""

    async def live_ids(self) -> list[uuid.UUID]: ...


@dataclass(frozen=True)
class DatabaseDashboardIndex:
    """打本服务库的大屏清单。"""

    database: Database

    async def live_ids(self) -> list[uuid.UUID]:
        """当前存在的全部大屏 id。"""
        async with self.database.session() as session:
            return await publish_crud.live_dashboard_ids(session)


@dataclass(frozen=True)
class DatabasePlanSource:
    """打本服务库的计划查询。

    ⚠ 一拍**一个会话、一条版本查询**：在看的屏有多少张，按张各开一个会话就是
    每一拍多少次 BEGIN/COMMIT，而绝大多数拍里一张都没变——只有版本真的变了
    的那几张才值得再读一遍绑定。
    ⚠ 版本与绑定仍在**同一个会话**里读：分成两次连接的话，中间的一次保存
    会让我们拿到新版本号配旧绑定，而那份错配会一直缓存到下一次版本变化。
    """

    database: Database

    async def load_many(
        self,
        dashboard_ids: Sequence[uuid.UUID],
        cached: Mapping[uuid.UUID, DashboardPlan],
    ) -> dict[uuid.UUID, PlanLookup]:
        """取一批大屏的计划；版本没变的原样把缓存还回去。

        Args: dashboard_ids, cached（上一拍留下的计划，按大屏索引）。
        """
        if not dashboard_ids:
            return {}
        async with self.database.session() as session:
            versions = await publish_crud.versions_of(session, dashboard_ids)
            lookups: dict[uuid.UUID, PlanLookup] = {}
            for dashboard_id in dashboard_ids:
                lookups[dashboard_id] = await _lookup_of(
                    session,
                    dashboard_id,
                    row_version=versions.get(dashboard_id),
                    cached=cached.get(dashboard_id),
                )
        return lookups


async def _lookup_of(
    session: AsyncSession,
    dashboard_id: uuid.UUID,
    *,
    row_version: int | None,
    cached: DashboardPlan | None,
) -> PlanLookup:
    """一张大屏的查询结果：查不到版本 = 它已经被删了。

    Args: session, dashboard_id, row_version, cached。
    """
    if row_version is None:
        return PlanLookup(plan=None, is_reloaded=False)
    if cached is not None and cached.row_version == row_version:
        return PlanLookup(plan=cached, is_reloaded=False)
    node_keys = await publish_crud.realtime_node_keys_of(session, dashboard_id)
    return PlanLookup(
        plan=DashboardPlan(row_version=row_version, node_keys=tuple(node_keys)),
        is_reloaded=True,
    )
