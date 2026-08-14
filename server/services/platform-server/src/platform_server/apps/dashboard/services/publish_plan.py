"""一张大屏的发布计划：它当前要推哪些点位，以及它的行版本。

⚠ 按 `row_version` 判断要不要重读：任何一次结构变更都会推进它（ADR-0012），
所以「版本没变就不必再读一遍绑定」是可靠的，而每拍重读整棵节点树不是。
"""

import uuid
from dataclasses import dataclass
from typing import Protocol

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
    """发布计划的最小查询面。真实现打库，测试用进程内假件。"""

    async def load(
        self, dashboard_id: uuid.UUID, cached: DashboardPlan | None
    ) -> PlanLookup: ...


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

    ⚠ 版本与绑定在**同一个只读会话**里读：分成两次连接的话，中间的一次保存
    会让我们拿到新版本号配旧绑定，而那份错配会一直缓存到下一次版本变化。
    """

    database: Database

    async def load(
        self, dashboard_id: uuid.UUID, cached: DashboardPlan | None
    ) -> PlanLookup:
        """取一张大屏的计划；版本没变就原样把缓存还回去。

        Args: dashboard_id, cached。
        """
        async with self.database.session() as session:
            versions = await publish_crud.versions_of(session, [dashboard_id])
            row_version = versions.get(dashboard_id)
            if row_version is None:
                return PlanLookup(plan=None, is_reloaded=False)
            if cached is not None and cached.row_version == row_version:
                return PlanLookup(plan=cached, is_reloaded=False)
            node_keys = await publish_crud.realtime_node_keys_of(
                session, dashboard_id
            )
        return PlanLookup(
            plan=DashboardPlan(
                row_version=row_version, node_keys=tuple(node_keys)
            ),
            is_reloaded=True,
        )
