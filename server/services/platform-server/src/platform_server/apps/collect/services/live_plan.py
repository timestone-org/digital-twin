"""分批读取一个数据源的全部实时点位身份，TTL 重读后逐条比对。

设计见 docs/COLLECT_DESIGN.md §9。
"""

import uuid
from dataclasses import dataclass
from typing import Protocol

from lib.db import Database
from platform_server.apps.collect.crud import point_crud, source_crud
from timeseries import compose_node_key


@dataclass(frozen=True)
class LivePlan:
    """一个数据源当前推的点位清单。"""

    node_keys: tuple[str, ...]


class LivePlanSource(Protocol):
    """点位清单的最小查询面。真实现打库，测试用进程内假件。"""

    async def load(
        self, source_id: uuid.UUID, *, batch_size: int
    ) -> LivePlan | None: ...


@dataclass(frozen=True)
class DatabaseLivePlanSource:
    """打本服务库的点位清单查询。"""

    database: Database

    async def load(
        self, source_id: uuid.UUID, *, batch_size: int
    ) -> LivePlan | None:
        """分批取一个数据源的全部点位身份，数据源已删除时返回 None。

        Args: source_id, batch_size。
        """
        async with self.database.session() as session:
            if await source_crud.get(session, source_id) is None:
                return None
            codes = await point_crud.codes_of(
                session, source_id, batch_size=batch_size
            )
        return LivePlan(
            node_keys=tuple(
                compose_node_key(source_id, code) for code in codes
            ),
        )
