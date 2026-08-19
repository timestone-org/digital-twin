"""匿名票据授权：一枚票据能订哪个主题，以及它的登记与注销。

⚠ 授权仍然**在本服务内比一次就完**，不回调业务服务（ADR-0007 §决策 3）：
推送方按对账把「票据指纹 → 主题」推过来，握手时查的是本地这张表。回调业务
服务的话，通道的握手路径就挂在了业务服务的可用性上，而通道是全站共用的。

⚠ 票据本身永不落库，落的是 SHA-256 指纹（`models/grant.py` 说明理由）。
指纹算法**两侧各写一份**（推送方登记时算一次、hub 握手时算一次），改它要
两边一起改——漂开的表现是所有公开链接一律订不上，而两边都不会报错。
"""

import hashlib

from lib.db import Database
from lib.logging import get_logger
from realtime_hub.apps.channel.crud import PublicGrantCrud, TopicCrud
from realtime_hub.apps.channel.errors import TopicNotDeclared

_logger = get_logger("realtime.grants")


def ticket_fingerprint(ticket: str) -> str:
    """一枚匿名票据的指纹。

    Args: ticket。
    """
    return hashlib.sha256(ticket.encode("utf-8")).hexdigest()


class PublicGrantRegistry:
    """匿名授权的登记、注销与解析。事务边界在这一层持有。"""

    def __init__(
        self,
        *,
        database: Database,
        grants: PublicGrantCrud,
        topics: TopicCrud,
    ) -> None:
        self._database = database
        self._grants = grants
        self._topics = topics

    async def declare(
        self, *, ticket_hash: str, topic: str, publisher: str
    ) -> None:
        """登记一枚票据对某个主题的匿名订阅授权。重复登记是幂等的。

        ⚠ 主题必须先登记：授权指向一个不存在的主题时，握手会过、订阅会成功、
        而数据永远不来——把它挡在这里，推送方下一轮对账（主题先于授权）就会
        自愈。

        Args: ticket_hash, topic, publisher。
        """
        async with self._database.session() as session:
            declaration = await self._topics.get_by_topic(session, topic)
            if declaration is None:
                raise TopicNotDeclared(f"主题 {topic} 未登记")
            await self._grants.upsert(
                session,
                ticket_hash=ticket_hash,
                topic=topic,
                publisher=publisher,
            )
        _logger.info(
            "public_grant_declared",
            "匿名授权已登记",
            topic=topic,
            publisher=publisher,
        )

    async def revoke(self, *, ticket_hash: str) -> bool:
        """注销一枚票据的授权。返回是否真的删掉了一行。

        ⚠ 注销只让**新的**握手订不上；已经连着的那些由复核任务摘掉
        （`services/sweeper.py`）。少了那一半，「撤回」只对还没连上的人成立。

        Args: ticket_hash。
        """
        async with self._database.session() as session:
            return await self._grants.delete_by_hash(session, ticket_hash)

    async def hashes_of(self, publisher: str) -> list[str]:
        """某个推送方名下的全部票据指纹，对账用。

        Args: publisher。
        """
        async with self._database.session() as session:
            return await self._grants.list_by_publisher(session, publisher)

    async def resolve(self, ticket: str) -> str | None:
        """一枚票据现在能订哪个主题；没有授权给 None。

        Args: ticket。
        """
        async with self._database.session() as session:
            return await self._grants.topic_of(
                session, ticket_fingerprint(ticket)
            )

    async def alive(self, ticket_hashes: frozenset[str]) -> dict[str, str]:
        """一批指纹里还有效的那些及其主题。复核任务按它一次问全。

        Args: ticket_hashes。
        """
        async with self._database.session() as session:
            return await self._grants.alive(session, sorted(ticket_hashes))
