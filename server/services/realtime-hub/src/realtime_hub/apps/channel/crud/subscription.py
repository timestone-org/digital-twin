"""订阅关系的数据访问。"""

import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from realtime_hub.apps.channel.models import Subscription


class SubscriptionCrud(CrudBase[Subscription]):
    """`subscription` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(Subscription)

    async def subscribe(
        self,
        session: AsyncSession,
        *,
        connection_id: uuid.UUID,
        user_id: uuid.UUID | None,
        topic: str,
        replica: str,
    ) -> None:
        """登记一条订阅。重复订阅是幂等的，不报错。

        ⚠ 走 `ON CONFLICT DO NOTHING` 而不是「先查再插」：后者不是幂等——
        同一条连接并发发两次 subscribe 时，两次查都说「没有」，然后两次插
        都撞唯一约束，其中一条会以 500 返回给客户端。

        Args: session, connection_id, user_id, topic, replica。
        """
        statement = (
            insert(Subscription)
            .values(
                connection_id=connection_id,
                user_id=user_id,
                topic=topic,
                replica=replica,
            )
            .on_conflict_do_nothing(
                constraint="uq_subscription_connection_topic"
            )
        )
        await session.execute(statement)

    async def unsubscribe(
        self, session: AsyncSession, *, connection_id: uuid.UUID, topic: str
    ) -> None:
        """退订一个主题。不存在也不报错——退订本就该幂等。

        Args: session, connection_id, topic。
        """
        await session.execute(
            delete(Subscription).where(
                Subscription.connection_id == connection_id,
                Subscription.topic == topic,
            )
        )

    async def drop_connection(
        self, session: AsyncSession, connection_id: uuid.UUID
    ) -> None:
        """连接关闭时清掉它的全部订阅。

        Args: session, connection_id。
        """
        await session.execute(
            delete(Subscription).where(
                Subscription.connection_id == connection_id
            )
        )

    async def drop_replica(self, session: AsyncSession, replica: str) -> int:
        """清掉某个副本残留的全部订阅，返回清掉的行数。

        ⚠ 副本被强杀时来不及清自己的行，重启后这些行会一直挂着，让对账
        看到「有人在订」而实际上没有任何连接。启动时按自己的副本名清一次。

        ⚠ 先数再删而不是读 `rowcount`：异步 `session.execute()` 的返回类型是
        `Result`，`rowcount` 只在 `CursorResult` 上，取它要一次类型断言。
        这个方法每个副本启动时只跑一次，多一次 COUNT 换掉一次断言是划算的。

        Args: session, replica。
        """
        condition = Subscription.replica == replica
        counted = await session.execute(
            select(func.count()).select_from(Subscription).where(condition)
        )
        total = int(counted.scalar_one())
        await session.execute(delete(Subscription).where(condition))
        return total

    async def topics_of(
        self, session: AsyncSession, connection_id: uuid.UUID
    ) -> list[str]:
        """某条连接当前订着哪些主题。权限复核要逐个重判。

        Args: session, connection_id。
        """
        result = await session.execute(
            select(Subscription.topic).where(
                Subscription.connection_id == connection_id
            )
        )
        return list(result.scalars().all())
