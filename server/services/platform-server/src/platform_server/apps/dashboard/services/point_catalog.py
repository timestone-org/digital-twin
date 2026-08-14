"""点位存在性的查询口 —— 绑定校验唯一要问外部的一件事。

⚠ 点位台账属于采集配置面（`apps/collect`，见 docs/COLLECT_DESIGN.md §5），
它落地之前本服务没有点位表，故组合根装的是一份**空名单**：`opcua` 与
`archive` 绑定一律 400 且指到字段，而不是静默放行一条永远产不出数据的绑定。
接线点是 `platform_server.container.build_container`。
"""

from dataclasses import dataclass, field
from typing import Protocol


class PointCatalog(Protocol):
    """点位台账的只读面。"""

    async def known_node_keys(
        self, node_keys: frozenset[str]
    ) -> frozenset[str]:
        """给一批 `node_key`，回其中确实存在的那些。

        Args: node_keys。
        """
        ...


@dataclass(frozen=True)
class StaticPointCatalog:
    """按一份固定名单作答的点位台账。空名单 = 一个点位都没有。"""

    known_keys: frozenset[str] = field(default_factory=frozenset[str])

    async def known_node_keys(
        self, node_keys: frozenset[str]
    ) -> frozenset[str]:
        """名单与问询的交集。

        Args: node_keys。
        """
        return node_keys & self.known_keys
