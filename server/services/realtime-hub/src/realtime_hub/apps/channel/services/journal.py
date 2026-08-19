"""订阅关系的落库面。

⚠ 库里那份订阅**不是**扇出的依据——扇出走进程内的连接注册表（连接是进程内
对象，跨副本不可共享）。这张表只供对账与诊断：主题登记了却没人订、副本被强杀
后留下的脏行，都是从这里看出来的。

抽成独立协作件而不是塞进 SessionService，是为了让会话逻辑的单元用例不必碰库。
"""

import uuid

from lib.db import Database
from realtime_hub.apps.channel.crud import SubscriptionCrud


class SubscriptionJournal:
    """把「谁在订什么」写进库。事务边界在每个方法内自持。"""

    def __init__(
        self, *, database: Database, crud: SubscriptionCrud, replica: str
    ) -> None:
        self._database = database
        self._crud = crud
        self._replica = replica

    async def record(
        self, *, connection_id: uuid.UUID, user_id: uuid.UUID | None, topic: str
    ) -> None:
        """记一条订阅。重复记是幂等的。

        ⚠ 匿名连接的 `user_id` 是 None，不是哨兵：公开链接的持有者不是任何
        一个人，塞一个编出来的 UUID 会让对账把它读成一个真实用户。

        Args: connection_id, user_id, topic。
        """
        async with self._database.session() as session:
            await self._crud.subscribe(
                session,
                connection_id=connection_id,
                user_id=user_id,
                topic=topic,
                replica=self._replica,
            )

    async def forget(self, *, connection_id: uuid.UUID, topic: str) -> None:
        """抹掉一条订阅。不存在也不报错。

        Args: connection_id, topic。
        """
        async with self._database.session() as session:
            await self._crud.unsubscribe(
                session, connection_id=connection_id, topic=topic
            )

    async def forget_all(self, connection_id: uuid.UUID) -> None:
        """连接关闭时抹掉它的全部订阅。

        Args: connection_id。
        """
        async with self._database.session() as session:
            await self._crud.drop_connection(session, connection_id)

    async def drop_replica(self) -> int:
        """清掉本副本上次残留的订阅行，返回清掉几行。"""
        async with self._database.session() as session:
            return await self._crud.drop_replica(session, self._replica)
