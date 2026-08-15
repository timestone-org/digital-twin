"""开机事件与人工排除的数据访问。批次与分片在 `ac_startup.py`。"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from lib.utils.ids import uuid7
from platform_server.apps.hvac.models import (
    AcStartupEpisode,
    AcStartupExclusion,
)
from platform_server.apps.hvac.schemas import TimeWindow
from platform_server.apps.hvac.startups import OUTCOME_USABLE


@dataclass(frozen=True)
class EpisodePage:
    """事件列表的一页：过滤条件加翻页锚点。"""

    limit: int
    before: datetime | None = None
    outcome: str | None = None
    running_set: tuple[str, ...] | None = None


class AcStartupEpisodeCrud(CrudBase[AcStartupEpisode]):
    """`hvac_ac_startup_episodes` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(AcStartupEpisode)

    async def upsert_many(
        self, session: AsyncSession, episodes: Sequence[AcStartupEpisode]
    ) -> None:
        """按自然键 `(batch_id, started_at)` 写入一批事件。

        ⚠ 队列是 at-least-once，故必须 upsert：「先查再插」在并发下仍会重复，
        而重复行会让同一次开机在训练集里出现两遍。
        Args: session, episodes。
        """
        if not episodes:
            return
        statement = insert(AcStartupEpisode).values(
            [_episode_values(episode) for episode in episodes]
        )
        await session.execute(
            statement.on_conflict_do_update(
                index_elements=[
                    AcStartupEpisode.batch_id,
                    AcStartupEpisode.started_at,
                ],
                set_={
                    "room_id": statement.excluded.room_id,
                    "running_set": statement.excluded.running_set,
                    "complied_at": statement.excluded.complied_at,
                    "duration_minutes": statement.excluded.duration_minutes,
                    "outcome": statement.excluded.outcome,
                    "readings": statement.excluded.readings,
                    "idle_minutes": statement.excluded.idle_minutes,
                    "updated_at": func.now(),
                },
            )
        )

    async def replace_window(
        self,
        session: AsyncSession,
        *,
        batch_id: uuid.UUID,
        window: TimeWindow,
        episodes: Sequence[AcStartupEpisode],
    ) -> int:
        """整窗替换：先删掉这一段里已有的事件，再写这一次算出来的。

        ⚠ 只 upsert 不删是不够的：带着更完整的数据重判一次，某次开机的**起始
        时刻会平移**（状态机认定的第一帧变了），旧那一行的键还在，于是同一次
        开机在库里留下两条（docs/AC_PUBLISH_DESIGN.md §6.3）。
        ⚠ 人工排除挂在 `(room_id, started_at)` 自然键上，不随事件行删除而丢失
        ——这正是当初把它挂在自然键上的理由。

        Args: session, batch_id, window, episodes。
        """
        stale = await session.execute(
            select(AcStartupEpisode.id).where(
                AcStartupEpisode.batch_id == batch_id,
                AcStartupEpisode.started_at >= window.start,
                AcStartupEpisode.started_at < window.end,
            )
        )
        found = list(stale.scalars().all())
        await session.execute(
            delete(AcStartupEpisode).where(AcStartupEpisode.id.in_(found))
        )
        await session.flush()
        session.add_all(episodes)
        await session.flush()
        return len(found)

    async def count_by_batch(
        self, session: AsyncSession, batch_id: uuid.UUID
    ) -> int:
        """一个批次里的事件总数。

        Args: session, batch_id。
        """
        result = await session.execute(
            select(func.count())
            .select_from(AcStartupEpisode)
            .where(AcStartupEpisode.batch_id == batch_id)
        )
        return int(result.scalar_one())

    async def list_by_batch(
        self, session: AsyncSession, batch_id: uuid.UUID
    ) -> list[AcStartupEpisode]:
        """一个批次里的全部事件，按起始时刻升序。

        Args: session, batch_id。
        """
        result = await session.execute(
            select(AcStartupEpisode)
            .where(AcStartupEpisode.batch_id == batch_id)
            .order_by(AcStartupEpisode.started_at.asc())
        )
        return list(result.scalars().all())

    async def page_by_batch(
        self,
        session: AsyncSession,
        batch_id: uuid.UUID,
        *,
        window: EpisodePage,
    ) -> list[AcStartupEpisode]:
        """一个批次里按过滤条件取一页事件，最新的在前。

        ⚠ 多取一行用来判断还有没有下一页，省掉一次会全表扫的计数。
        Args: session, batch_id, window。
        """
        statement = select(AcStartupEpisode).where(
            AcStartupEpisode.batch_id == batch_id
        )
        if window.outcome is not None:
            statement = statement.where(
                AcStartupEpisode.outcome == window.outcome
            )
        if window.running_set is not None:
            # 组合按 serial 升序存，等值比较才稳定
            statement = statement.where(
                AcStartupEpisode.running_set == list(window.running_set)
            )
        if window.before is not None:
            statement = statement.where(
                AcStartupEpisode.started_at < window.before
            )
        result = await session.execute(
            statement.order_by(AcStartupEpisode.started_at.desc()).limit(
                window.limit + 1
            )
        )
        return list(result.scalars().all())

    async def coverage(
        self, session: AsyncSession, batch_id: uuid.UUID
    ) -> list[tuple[list[str], int]]:
        """一个批次里各运行组合各攒了多少条可用样本，多的在前。

        Args: session, batch_id。
        """
        rows = await session.execute(
            select(AcStartupEpisode.running_set, func.count())
            .where(
                AcStartupEpisode.batch_id == batch_id,
                AcStartupEpisode.outcome == OUTCOME_USABLE,
            )
            .group_by(AcStartupEpisode.running_set)
            .order_by(func.count().desc(), AcStartupEpisode.running_set.asc())
        )
        return [(list(running_set), int(total)) for running_set, total in rows]

    async def count_by_outcome(
        self, session: AsyncSession, batch_id: uuid.UUID
    ) -> dict[str, int]:
        """一个批次里各类结果各有多少条。批次摘要与组合覆盖度都要它。

        Args: session, batch_id。
        """
        rows = await session.execute(
            select(AcStartupEpisode.outcome, func.count())
            .where(AcStartupEpisode.batch_id == batch_id)
            .group_by(AcStartupEpisode.outcome)
        )
        return {outcome: int(total) for outcome, total in rows.all()}


class AcStartupExclusionCrud(CrudBase[AcStartupExclusion]):
    """`hvac_ac_startup_exclusions` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(AcStartupExclusion)

    async def list_by_room(
        self, session: AsyncSession, room_id: uuid.UUID
    ) -> list[AcStartupExclusion]:
        """一个房间的全部人工排除，按起始时刻升序。

        Args: session, room_id。
        """
        result = await session.execute(
            select(AcStartupExclusion)
            .where(AcStartupExclusion.room_id == room_id)
            .order_by(AcStartupExclusion.started_at.asc())
        )
        return list(result.scalars().all())

    async def upsert(
        self, session: AsyncSession, exclusion: AcStartupExclusion
    ) -> None:
        """按自然键 `(room_id, started_at)` 写一条人工排除，重复调用是覆盖。

        Args: session, exclusion。
        """
        statement = insert(AcStartupExclusion).values(
            {
                "id": uuid7(),
                "room_id": exclusion.room_id,
                "started_at": exclusion.started_at,
                "reason": exclusion.reason,
                "excluded_by": exclusion.excluded_by,
            }
        )
        await session.execute(
            statement.on_conflict_do_update(
                index_elements=[
                    AcStartupExclusion.room_id,
                    AcStartupExclusion.started_at,
                ],
                set_={
                    "reason": statement.excluded.reason,
                    "excluded_by": statement.excluded.excluded_by,
                    "updated_at": func.now(),
                },
            )
        )

    async def map_by_room(
        self, session: AsyncSession, room_id: uuid.UUID
    ) -> dict[datetime, AcStartupExclusion]:
        """一个房间的人工排除，按起始时刻索引。

        ⚠ 列表页逐条回查就是 N+1，故一次取回在内存里对齐。
        Args: session, room_id。
        """
        rows = await self.list_by_room(session, room_id)
        return {row.started_at: row for row in rows}

    async def count_unmatched(
        self, session: AsyncSession, *, room_id: uuid.UUID, batch_id: uuid.UUID
    ) -> int:
        """有多少条人工排除在这一批事件里找不到对应的起始时刻。

        ⚠ 参数一变，某些事件的起始时刻会平移、旧键就落空了。这个数必须报出来
        并呈现在批次摘要里，否则人工判断会静默地烂掉而没人察觉。
        Args: session, room_id, batch_id。
        """
        matched = (
            select(AcStartupEpisode.id)
            .where(
                AcStartupEpisode.batch_id == batch_id,
                AcStartupEpisode.started_at == AcStartupExclusion.started_at,
            )
            .exists()
        )
        result = await session.execute(
            select(func.count())
            .select_from(AcStartupExclusion)
            .where(AcStartupExclusion.room_id == room_id, ~matched)
        )
        return int(result.scalar_one())

    async def find(
        self,
        session: AsyncSession,
        *,
        room_id: uuid.UUID,
        started_at: datetime,
    ) -> AcStartupExclusion | None:
        """按自然键取一条人工排除。

        Args: session, room_id, started_at。
        """
        result = await session.execute(
            select(AcStartupExclusion).where(
                AcStartupExclusion.room_id == room_id,
                AcStartupExclusion.started_at == started_at,
            )
        )
        return result.scalar_one_or_none()

    async def delete_by_key(
        self, session: AsyncSession, room_id: uuid.UUID, started_at: datetime
    ) -> int:
        """按自然键删掉一条人工排除，返回删掉的条数。

        Args: session, room_id, started_at。
        """
        rows = await session.execute(
            select(AcStartupExclusion.id).where(
                AcStartupExclusion.room_id == room_id,
                AcStartupExclusion.started_at == started_at,
            )
        )
        found = list(rows.scalars().all())
        await session.execute(
            delete(AcStartupExclusion).where(AcStartupExclusion.id.in_(found))
        )
        return len(found)


def _episode_values(episode: AcStartupEpisode) -> dict[str, object]:
    """把一个事件实体摊成 upsert 的取值。

    ⚠ 主键现取而不留给列默认值：`insert().values([...])` 走的是 Core 路径，
    ORM 的默认值在这条路上不会被求值。
    Args: episode。
    """
    return {
        "id": uuid7(),
        "batch_id": episode.batch_id,
        "room_id": episode.room_id,
        "started_at": episode.started_at,
        "running_set": list(episode.running_set),
        "complied_at": episode.complied_at,
        "duration_minutes": episode.duration_minutes,
        "outcome": episode.outcome,
        "readings": dict(episode.readings),
        # ⚠ 少了这一列，蓄热特征（AC_MODEL_DESIGN §2.5）永远是 NaN——状态机
        # 明明数出来了，却停在 Core 路径的取值表外面，而没有任何地方会报错
        "idle_minutes": episode.idle_minutes,
    }


ac_startup_episode_crud = AcStartupEpisodeCrud()
ac_startup_exclusion_crud = AcStartupExclusionCrud()
