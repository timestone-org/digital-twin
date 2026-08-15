"""抽取批次与分片的数据访问。事件与人工排除在 `ac_startup_events.py`。"""

import uuid
from collections.abc import Sequence

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from lib.utils.ids import uuid7
from platform_server.apps.hvac.models import AcStartupBatch, AcStartupShard
from platform_server.apps.hvac.startups import (
    BATCH_STATUS_RUNNING,
    SHARD_STATUS_PENDING,
)


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

    async def rooms_with_current(
        self, session: AsyncSession
    ) -> list[uuid.UUID]:
        """有当前批次的全部房间，按 id 升序。

        ⚠ 排序是为了让每晚的入队次序稳定：不排序时日志里房间的先后每天都变，
        而「今晚是不是漏了一个房间」正要靠比对这份清单来看。

        Args: session。
        """
        result = await session.execute(
            select(AcStartupBatch.room_id)
            .where(AcStartupBatch.is_current.is_(True))
            .order_by(AcStartupBatch.room_id.asc())
        )
        return list(result.scalars().all())

    async def find_running(
        self, session: AsyncSession, room_id: uuid.UUID
    ) -> AcStartupBatch | None:
        """一个房间正在跑的批次，没有就给 None。

        Args: session, room_id。
        """
        result = await session.execute(
            select(AcStartupBatch)
            .where(
                AcStartupBatch.room_id == room_id,
                AcStartupBatch.status == BATCH_STATUS_RUNNING,
            )
            .limit(1)
        )
        return result.scalars().first()

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


ac_startup_batch_crud = AcStartupBatchCrud()
ac_startup_shard_crud = AcStartupShardCrud()
