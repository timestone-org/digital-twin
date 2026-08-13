"""主题声明的数据访问。"""

from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from realtime_hub.apps.channel.models import TopicDeclaration


class TopicCrud(CrudBase[TopicDeclaration]):
    """`topic_declaration` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(TopicDeclaration)

    async def get_by_topic(
        self, session: AsyncSession, topic: str
    ) -> TopicDeclaration | None:
        """按主题名取声明。主题名唯一，它是这张表的自然键。

        Args: session, topic。
        """
        result = await session.execute(
            select(TopicDeclaration).where(TopicDeclaration.topic == topic)
        )
        return result.scalars().one_or_none()

    async def bump_seq(
        self, session: AsyncSession, topic: str, *, now: datetime
    ) -> int | None:
        """自增并返回该主题的新 seq；主题不存在返回 None。

        ⚠ 必须是**一条** `UPDATE … RETURNING`：先读后写会在两个副本同时推送
        时读到同一个旧值，于是两条消息带着同一个 seq 发出去——客户端据 seq
        发现丢帧，重号比丢号更糟，它会把后一条当成重复而丢弃。
        ⚠ 同理不能用 ORM 的属性赋值：那是「读进内存 +1 再写回」。

        Args: session, topic, now（本次推送的时刻）。
        """
        statement = (
            update(TopicDeclaration)
            .where(TopicDeclaration.topic == topic)
            .values(
                seq=TopicDeclaration.seq + 1,
                last_published_at=now,
            )
            .returning(TopicDeclaration.seq)
        )
        result = await session.execute(statement)
        return result.scalar_one_or_none()

    async def delete_by_topic(self, session: AsyncSession, topic: str) -> bool:
        """按主题名删除声明；订阅由外键级联跟着走。返回是否真的删掉了一行。

        ⚠ 返回值必须用上：注销走 at-least-once，重复注销是正常路径，但
        「一次都没删到」与「删掉了」对推送方的对账是两回事。

        Args: session, topic。
        """
        declaration = await self.get_by_topic(session, topic)
        if declaration is None:
            return False
        await session.delete(declaration)
        return True
