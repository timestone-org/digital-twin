"""抽取批次、开机事件与人工排除的数据访问。"""

import uuid
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from lib.utils.ids import uuid7
from platform_server.apps.hvac.models import (
    AcStartupBatch,
    AcStartupEpisode,
    AcStartupExclusion,
    AcStartupShard,
)
from platform_server.apps.hvac.startups import SHARD_STATUS_PENDING


class AcStartupBatchCrud(CrudBase[AcStartupBatch]):
    """`hvac_ac_startup_batches` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(AcStartupBatch)

    async def list_by_room(
        self, session: AsyncSession, room_id: uuid.UUID, *, limit: int
    ) -> list[AcStartupBatch]:
        """一个房间最近的几个批次，最新的在前。

        Args: session, room_id, limit。
        """
        result = await session.execute(
            select(AcStartupBatch)
            .where(AcStartupBatch.room_id == room_id)
            .order_by(
                AcStartupBatch.created_at.desc(), AcStartupBatch.id.desc()
            )
            .limit(limit)
        )
        return list(result.scalars().all())

    async def lock(
        self, session: AsyncSession, batch_id: uuid.UUID
    ) -> AcStartupBatch | None:
        """取一个批次并把它这一行锁到事务结束。

        ⚠ 最后两片可能由两个 worker 同时跑完，两边都会看到「全都完成了」。
        不加行锁就会各自收尾一次：切换、清理、计数全做两遍。
        Args: session, batch_id。
        """
        result = await session.execute(
            select(AcStartupBatch)
            .where(AcStartupBatch.id == batch_id)
            .with_for_update()
        )
        return result.scalar_one_or_none()

    async def find_current(
        self, session: AsyncSession, room_id: uuid.UUID
    ) -> AcStartupBatch | None:
        """一个房间的当前批次，没有就给 None。

        Args: session, room_id。
        """
        result = await session.execute(
            select(AcStartupBatch).where(
                AcStartupBatch.room_id == room_id,
                AcStartupBatch.is_current.is_(True),
            )
        )
        return result.scalar_one_or_none()

    async def promote_current(
        self, session: AsyncSession, batch: AcStartupBatch
    ) -> None:
        """把一个批次切换成房间的当前批次。

        ⚠ 让位与就位必须在同一个事务里：先算新批次、校验通过再原子切换，绝不
        先删后算——中途失败会同时失去新旧两份。
        Args: session, batch。
        """
        # ⚠ 先落一次盘：批次还没有 id 时，下面那条「除了它自己」的 where 会拿
        # NULL 去比，旧的当前批次一条也让不出来，随后就撞上部分唯一索引
        await session.flush()
        await session.execute(
            update(AcStartupBatch)
            .where(
                AcStartupBatch.room_id == batch.room_id,
                AcStartupBatch.id != batch.id,
                AcStartupBatch.is_current.is_(True),
            )
            .values(is_current=False, updated_at=func.now())
        )
        batch.is_current = True
        await session.flush()

    async def prune(
        self, session: AsyncSession, room_id: uuid.UUID, *, keep: int
    ) -> list[uuid.UUID]:
        """只留一个房间最近的 keep 个批次，返回被删掉的批次 id。

        ⚠ 当前批次永远不在删除范围内：重算期间页面显示的就是它。
        Args: session, room_id, keep。
        """
        keepers = (
            select(AcStartupBatch.id)
            .where(AcStartupBatch.room_id == room_id)
            .order_by(
                AcStartupBatch.created_at.desc(), AcStartupBatch.id.desc()
            )
            .limit(keep)
        )
        doomed = await session.execute(
            select(AcStartupBatch.id).where(
                AcStartupBatch.room_id == room_id,
                AcStartupBatch.id.not_in(keepers),
                AcStartupBatch.is_current.is_(False),
            )
        )
        batch_ids = list(doomed.scalars().all())
        await session.execute(
            delete(AcStartupBatch).where(AcStartupBatch.id.in_(batch_ids))
        )
        return batch_ids


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
                    "updated_at": func.now(),
                },
            )
        )

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


class AcStartupShardCrud(CrudBase[AcStartupShard]):
    """`hvac_ac_startup_shards` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(AcStartupShard)

    async def seed(
        self, session: AsyncSession, batch_id: uuid.UUID, months: Sequence[str]
    ) -> None:
        """为一个批次登记全部分片，初始都是待跑。

        Args: session, batch_id, months。
        """
        if not months:
            return
        statement = insert(AcStartupShard).values(
            [
                {
                    "id": uuid7(),
                    "batch_id": batch_id,
                    "month": month,
                    "status": SHARD_STATUS_PENDING,
                }
                for month in months
            ]
        )
        await session.execute(
            statement.on_conflict_do_nothing(
                index_elements=[AcStartupShard.batch_id, AcStartupShard.month]
            )
        )

    async def mark(
        self,
        session: AsyncSession,
        shard: AcStartupShard,
        *,
        status: str,
        error: str | None = None,
    ) -> None:
        """按自然键把一片置成某个状态，重复调用是覆盖。

        ⚠ 是覆盖不是累加：同一条消息重放一次，进度不该跟着多走一格。
        Args: session, shard, status, error。
        """
        statement = insert(AcStartupShard).values(
            {
                "id": uuid7(),
                "batch_id": shard.batch_id,
                "month": shard.month,
                "status": status,
                "error": error,
            }
        )
        await session.execute(
            statement.on_conflict_do_update(
                index_elements=[
                    AcStartupShard.batch_id,
                    AcStartupShard.month,
                ],
                set_={
                    "status": statement.excluded.status,
                    "error": statement.excluded.error,
                    "updated_at": func.now(),
                },
            )
        )

    async def count_by_status(
        self, session: AsyncSession, batch_id: uuid.UUID
    ) -> dict[str, int]:
        """一个批次里各状态的分片各有多少片。进度由它数出来。

        Args: session, batch_id。
        """
        rows = await session.execute(
            select(AcStartupShard.status, func.count())
            .where(AcStartupShard.batch_id == batch_id)
            .group_by(AcStartupShard.status)
        )
        return {status: int(total) for status, total in rows.all()}

    async def list_by_batch(
        self, session: AsyncSession, batch_id: uuid.UUID
    ) -> list[AcStartupShard]:
        """一个批次的全部分片，按月份升序。

        Args: session, batch_id。
        """
        result = await session.execute(
            select(AcStartupShard)
            .where(AcStartupShard.batch_id == batch_id)
            .order_by(AcStartupShard.month.asc())
        )
        return list(result.scalars().all())


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
    }


ac_startup_batch_crud = AcStartupBatchCrud()
ac_startup_shard_crud = AcStartupShardCrud()
ac_startup_episode_crud = AcStartupEpisodeCrud()
ac_startup_exclusion_crud = AcStartupExclusionCrud()
