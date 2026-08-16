"""采集主题登记的对账：把 hub 那边的主题拉回与数据源表一致。

与大屏那侧同源、同理由（ADR-0007 要求注销按 at-least-once 处理且必须有一条
对账）。两边各跑各的，靠不同的 `publisher` 名字互不越界——共用一个名字的话，
一方对账时会把另一方的主题当成「多出来的」全部注销掉。

⚠ 主题未登记时 hub 一律拒订，所以对账周期同时是「新建的数据源多久之后可被
订阅」的上界。
"""

import uuid
from dataclasses import dataclass
from typing import Protocol

from lib.db import Database
from lib.logging import get_logger
from platform_server.apps.collect.crud import source_crud
from platform_server.apps.collect.services.topics import (
    PUBLISHER_NAME,
    TOPIC_REQUIRED_CODE,
    topic_of,
)
from platform_server.realtime import TopicRegistrar

_logger = get_logger("platform.collect.topics")


class SourceIndex(Protocol):
    """数据源清单的最小查询面。主题对账拿它当权威。"""

    async def live_ids(self) -> list[uuid.UUID]: ...


@dataclass(frozen=True)
class DatabaseSourceIndex:
    """打本服务库的数据源清单。"""

    database: Database

    async def live_ids(self) -> list[uuid.UUID]:
        """当前存在的全部数据源 id。

        ⚠ 不过滤 `is_enabled`：停用的数据源照样要能打开配置页看它「为什么
        没有值」，订不上主题只会让那一页空着且说不出原因。
        """
        async with self.database.session() as session:
            return [row.id for row in await source_crud.list_all(session)]


class CollectTopicReconciler:
    """让 hub 上的采集主题与数据源表对齐。"""

    def __init__(
        self, *, sources: SourceIndex, realtime: TopicRegistrar
    ) -> None:
        """按数据源清单与 hub 客户端初始化。

        Args: sources, realtime。
        """
        self._sources = sources
        self._realtime = realtime

    async def reconcile(self) -> tuple[int, int]:
        """补齐缺的、注销多的，返回 (补了几个, 注销了几个)。

        ⚠ 只把**本服务的数据源表**当权威：hub 那份主题清单是我们推过去的
        投影，反过来拿它去改数据源表就是把通道服务当成了业务真源。
        ⚠ 单条失败不重试也不抛：下一轮还会再对一次。这一层重试会与「hub 正在
        重启」撞在一起，把一拍拖成一串超时。
        """
        live = await self._sources.live_ids()
        expected = {topic_of(source_id) for source_id in live}
        actual = set(await self._realtime.topics(PUBLISHER_NAME))
        declared = await self._declare_missing(live, actual)
        revoked = await self._revoke_extra(expected, actual)
        _logger.info(
            "collect_topics_reconciled",
            "采集主题对账完成",
            sources=len(live),
            declared=declared,
            revoked=revoked,
        )
        return declared, revoked

    async def _declare_missing(
        self, live: list[uuid.UUID], actual: set[str]
    ) -> int:
        """给 hub 上缺的数据源补登记。

        Args: live, actual。
        """
        declared = 0
        for source_id in live:
            if topic_of(source_id) in actual:
                continue
            declared += int(
                await self._realtime.declare(
                    topic=topic_of(source_id),
                    required_code=TOPIC_REQUIRED_CODE,
                    publisher=PUBLISHER_NAME,
                )
            )
        return declared

    async def _revoke_extra(self, expected: set[str], actual: set[str]) -> int:
        """注销数据源已经不在、主题还挂着的那些。

        ⚠ 方向单向：以 hub 的清单为输入。取不到清单时输入为空，于是什么都不
        注销——宁可多留一个空主题，也不要因为一次超时把全量主题清光。
        Args: expected, actual。
        """
        revoked = 0
        for topic in sorted(actual - expected):
            revoked += int(await self._realtime.revoke(topic))
        return revoked
