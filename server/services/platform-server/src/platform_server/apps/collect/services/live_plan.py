"""一个数据源当前要推哪些点位。

与大屏那侧不同，采集点位表**没有行版本**可比：一次建点只动 `collect_points`，
没有任何计数器会被推进。故这里靠**周期重读 + 逐条比对**收敛——重读周期
（`collect_live_plan_ttl_s`）同时是「新建的点位多久之后开始有实时值」的上界，
比对结果决定要不要补一帧全量。

⚠ 取前 N 个而不是全量：一台设备挂上万个点位时，配置页一屏只看得见几十行。
截断与否如实回给界面（`is_truncated`），静默截断会让人以为「这些点位没值」。
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
    # 该数据源的点位比上限多，清单只是前 N 个
    is_truncated: bool


class LivePlanSource(Protocol):
    """点位清单的最小查询面。真实现打库，测试用进程内假件。"""

    async def load(
        self, source_id: uuid.UUID, *, limit: int
    ) -> LivePlan | None: ...


@dataclass(frozen=True)
class DatabaseLivePlanSource:
    """打本服务库的点位清单查询。"""

    database: Database

    async def load(
        self, source_id: uuid.UUID, *, limit: int
    ) -> LivePlan | None:
        """取一个数据源的点位清单；数据源已经不在时返回 None。

        ⚠ 多取一条来判断有没有截断：拿 `count(*)` 另问一次的话，两次查询
        中间的一次建点会让「清单」与「总数」对不上。
        Args: source_id, limit。
        """
        async with self.database.session() as session:
            if await source_crud.get(session, source_id) is None:
                return None
            codes = await point_crud.codes_of(
                session, source_id, limit=limit + 1
            )
        return LivePlan(
            node_keys=tuple(
                compose_node_key(source_id, code) for code in codes[:limit]
            ),
            is_truncated=len(codes) > limit,
        )
