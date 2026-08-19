"""匿名授权的数据访问。"""

from collections.abc import Sequence

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from realtime_hub.apps.channel.models import PublicGrant


class PublicGrantCrud(CrudBase[PublicGrant]):
    """`public_grant` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(PublicGrant)

    async def upsert(
        self,
        session: AsyncSession,
        *,
        ticket_hash: str,
        topic: str,
        publisher: str,
    ) -> None:
        """登记一条授权。重复登记是幂等的。

        ⚠ 走 `ON CONFLICT DO UPDATE` 而不是「先查再插」：对账每 5 秒重放一次
        全集，先查再插在并发下会撞唯一约束，而那次 500 会让整轮对账中断。

        Args: session, ticket_hash, topic, publisher。
        """
        statement = (
            insert(PublicGrant)
            .values(ticket_hash=ticket_hash, topic=topic, publisher=publisher)
            .on_conflict_do_update(
                index_elements=[PublicGrant.ticket_hash],
                set_={"topic": topic, "publisher": publisher},
            )
        )
        await session.execute(statement)

    async def topic_of(
        self, session: AsyncSession, ticket_hash: str
    ) -> str | None:
        """一枚票据指纹当前授权的主题；没有授权给 None。

        Args: session, ticket_hash。
        """
        rows = await session.execute(
            select(PublicGrant.topic).where(
                PublicGrant.ticket_hash == ticket_hash
            )
        )
        return rows.scalars().one_or_none()

    async def alive(
        self, session: AsyncSession, ticket_hashes: Sequence[str]
    ) -> dict[str, str]:
        """一批指纹里还有效的那些，映射到它们现在授权的主题。

        ⚠ 一次查一批而不是逐条查：复核跑在定时任务里，逐条查会让匿名连接数
        直接变成每轮的查询数。

        Args: session, ticket_hashes。
        """
        if not ticket_hashes:
            return {}
        rows = await session.execute(
            select(PublicGrant.ticket_hash, PublicGrant.topic).where(
                PublicGrant.ticket_hash.in_(list(ticket_hashes))
            )
        )
        return {row.ticket_hash: row.topic for row in rows.all()}

    async def list_by_publisher(
        self, session: AsyncSession, publisher: str
    ) -> list[str]:
        """某个推送方名下的全部票据指纹，按指纹升序。

        Args: session, publisher。
        """
        rows = await session.execute(
            select(PublicGrant.ticket_hash)
            .where(PublicGrant.publisher == publisher)
            .order_by(PublicGrant.ticket_hash)
        )
        return list(rows.scalars().all())

    async def delete_by_hash(
        self, session: AsyncSession, ticket_hash: str
    ) -> bool:
        """注销一条授权，返回是否真的删掉了一行。

        ⚠ 先数再删：异步 `session.execute()` 返回 `Result`，`rowcount` 只在
        `CursorResult` 上，取它要一次类型断言（与 `SubscriptionCrud` 同口径）。

        Args: session, ticket_hash。
        """
        condition = PublicGrant.ticket_hash == ticket_hash
        counted = await session.execute(
            select(func.count()).select_from(PublicGrant).where(condition)
        )
        existed = int(counted.scalar_one()) > 0
        await session.execute(delete(PublicGrant).where(condition))
        return existed
