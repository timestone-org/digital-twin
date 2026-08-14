"""点位台账的只读面 —— 大屏绑定校验唯一要问的外部事实。

⚠ 这是 `apps/dashboard` 那个 `PointCatalog` 协议的真实现：绑一个不存在的点位
必须当场 400 并指到字段，而不是静默放行一条永远产不出数据的绑定
（ADR-0012 决策四）。接线点是 `platform_server.container.build_container`。
⚠ 它开**自己的短事务**：调用点在大屏那侧的请求事务里，而这是一次跨功能模块
的存在性询问，共用事务会让两个模块的锁互相牵连。
"""

from collections.abc import Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from typing import Protocol

from sqlalchemy import select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.collect.models import CollectPoint
from timeseries import InvalidNodeKey, compose_node_key, split_node_key


class SessionSource(Protocol):
    """开一个会话的最小面。真实现是 `lib.db.Database`。"""

    def session(self) -> AbstractAsyncContextManager[AsyncSession]: ...


@dataclass(frozen=True)
class DatabasePointCatalog:
    """按 `collect_points` 表作答的点位台账。"""

    sessions: SessionSource

    async def known_node_keys(
        self, node_keys: frozenset[str]
    ) -> frozenset[str]:
        """给一批 `node_key`，回其中确实存在的那些。

        Args: node_keys。
        """
        pairs = _parse(node_keys)
        if not pairs:
            return frozenset()
        async with self.sessions.session() as session:
            return await _lookup(session, pairs)


def _parse(node_keys: frozenset[str]) -> list[tuple[str, str]]:
    """把 `node_key` 拆成 `(source_id, point_code)`；拆不开的直接丢。

    ⚠ 丢掉即「不存在」，正是想要的：形状不对的 key 本来就指不到任何点位。
    Args: node_keys。
    """
    pairs: list[tuple[str, str]] = []
    for node_key in sorted(node_keys):
        try:
            source_id, point_code = split_node_key(node_key)
        except InvalidNodeKey:
            continue
        pairs.append((str(source_id), point_code))
    return pairs


async def _lookup(
    session: AsyncSession, pairs: Sequence[tuple[str, str]]
) -> frozenset[str]:
    """查库并把命中的行拼回 `node_key`。

    Args: session, pairs。
    """
    rows = await session.execute(
        select(CollectPoint.source_id, CollectPoint.code).where(
            tuple_(CollectPoint.source_id, CollectPoint.code).in_(list(pairs))
        )
    )
    return frozenset(
        compose_node_key(source_id, code) for source_id, code in rows.all()
    )
