"""主题声明的生命周期与订阅授权。

事务边界在这一层持有（database-standard.md）。⚠ 校验权限码是**外部 IO**，
必须在事务之外做完再进事务——事务内做外部 IO 会让一次 auth 抖动把数据库
连接一起占住。
"""

from lib.db import Database
from lib.logging import get_logger
from realtime_hub.apps.channel.crud import TopicCrud
from realtime_hub.apps.channel.errors import (
    SubscriptionDenied,
    TopicAlreadyDeclared,
    TopicNotDeclared,
    UnknownPermissionCode,
)
from realtime_hub.apps.channel.models import TopicDeclaration
from realtime_hub.apps.channel.services.code_catalog import CodeCatalog

_logger = get_logger("realtime.registry")


class TopicRegistry:
    """主题的登记、注销与订阅授权。"""

    def __init__(
        self, *, database: Database, catalog: CodeCatalog, topics: TopicCrud
    ) -> None:
        self._database = database
        self._catalog = catalog
        self._topics = topics

    async def declare(
        self, *, topic: str, required_code: str, publisher: str
    ) -> None:
        """登记一个主题并声明订阅它所需的权限码。

        同码重复登记是**幂等**的：注销走 at-least-once，推送方重试是正常路径。
        只有「同名不同码」才是真冲突——那意味着两个推送方在抢同一个主题，
        放过去会让订阅授权按谁先登记而定。

        ⚠ 校验放在事务外：`known_codes()` 是一次跨服务调用，取不到即
        fail-closed 拒绝登记（CONTEXT.md §7），此时还没开事务。

        Args: topic, required_code, publisher。
        """
        known = await self._catalog.known_codes()
        if required_code not in known:
            raise UnknownPermissionCode(
                f"权限码 {required_code} 不在权限码目录里"
            )
        async with self._database.session() as session:
            existing = await self._topics.get_by_topic(session, topic)
            if existing is not None:
                if existing.required_code != required_code:
                    raise TopicAlreadyDeclared(
                        "该主题已被登记，且声明的权限码与本次不同"
                    )
                return
            self._topics.add(
                session,
                TopicDeclaration(
                    topic=topic,
                    required_code=required_code,
                    publisher=publisher,
                ),
            )
        _logger.info(
            "topic_declared",
            "主题已登记",
            topic=topic,
            required_code=required_code,
            publisher=publisher,
        )

    async def revoke(self, *, topic: str) -> bool:
        """注销一个主题；订阅由外键级联跟着走。返回是否真的删掉了一行。

        ⚠ 返回值要用上：注销是 at-least-once，重复注销是正常路径，但
        「一次都没删到」与「删掉了」对推送方的对账是两回事。

        Args: topic。
        """
        async with self._database.session() as session:
            removed = await self._topics.delete_by_topic(session, topic)
        _logger.info(
            "topic_revoked", "主题已注销", topic=topic, existed=removed
        )
        return removed

    async def topics_of(self, publisher: str) -> list[str]:
        """某个推送方名下的全部主题。

        Args: publisher。
        """
        async with self._database.session() as session:
            return await self._topics.list_by_publisher(session, publisher)

    async def authorize(self, *, topic: str, codes: frozenset[str]) -> str:
        """判断某个持码集合能否订阅该主题，返回该主题声明的码。

        两条拒绝路径必须分开：

        - 主题未登记 → `TopicNotDeclared`。⚠ 不许放行「先订后建」：开放命名
          空间下主题名拼错不再是语法错误，放行会让拼错名字的客户端安静地
          永远收不到数据（ADR-0007 §决策 5）。
        - 登记了但码不够 → `SubscriptionDenied`。

        合成一条的话，页面没法告诉用户到底是「名字写错了」还是「你没权限」。

        Args: topic, codes。
        """
        async with self._database.session() as session:
            declaration = await self._topics.get_by_topic(session, topic)
        if declaration is None:
            raise TopicNotDeclared(f"主题 {topic} 未登记")
        if declaration.required_code not in codes:
            raise SubscriptionDenied("没有订阅该主题的权限")
        return declaration.required_code
