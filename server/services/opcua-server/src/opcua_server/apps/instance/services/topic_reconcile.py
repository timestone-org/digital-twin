"""主题登记的对账：把 hub 那边的主题拉回与实例表一致。

主题是**旁路数据**，与实例表是两套存储、两次写入，中间隔着一次跨服务调用。
登记与注销都按 at-least-once 处理（失败只记日志、不阻断实例的生灭），代价
就是会漂：

- 建实例时 hub 不可达 → 主题**缺**，那台实例永远推不出值，而页面上一切正常
- 删实例时 hub 不可达 → 主题**多**，留下一个谁也推不到、却仍可被订阅的空主题

⚠ ADR-0007 明确要求「注销按 at-least-once 处理，且必须有一条对账，不允许静默
失败」。这个文件就是那条对账。它在启动时跑一次——那正是上一次漂移最可能发生
的时刻（进程被杀、hub 当时不可达）。
"""

import uuid

from lib.db import Database
from lib.logging import get_logger
from opcua_server.apps.instance.crud import instance_crud
from opcua_server.apps.instance.services.realtime import (
    RealtimeClient,
    topic_of,
)

_logger = get_logger("opcua.topic_reconcile")


class TopicReconciler:
    """让 hub 上的主题与实例表对齐。"""

    def __init__(self, *, database: Database, realtime: RealtimeClient) -> None:
        self._database = database
        self._realtime = realtime

    async def reconcile(self) -> tuple[int, int]:
        """补齐缺的、清掉多的，返回 (补了几个, 清了几个)。

        ⚠ 只按**本服务的实例表**当权威：hub 不认识实例，它那份主题清单是我们
        推过去的投影。反过来拿 hub 的清单去改实例表，就把通道服务当成了业务
        真源。

        ⚠ 单条失败不重试也不抛：下次启动还会再对一次。这一层重试会与「hub
        正在重启」撞在一起，把启动拖成一串超时，而对账本身不该阻塞启动。
        """
        async with self._database.session() as session:
            live = await instance_crud.all_ids(session)
        expected = {topic_of(instance_id) for instance_id in live}
        actual = set(await self._realtime.topics())
        declared = await self._declare_missing(live, actual)
        revoked = await self._revoke_extra(expected, actual)
        _logger.info(
            "topics_reconciled",
            "主题对账完成",
            instances=len(live),
            declared=declared,
            revoked=revoked,
        )
        return declared, revoked

    async def _declare_missing(
        self, live: list[uuid.UUID], actual: set[str]
    ) -> int:
        """给 hub 上缺的实例补登记。

        缺主题的实例永远推不出值，而页面上一切正常——这是最难查的那一半。

        Args: live, actual。
        """
        missing = [
            instance_id
            for instance_id in live
            if topic_of(instance_id) not in actual
        ]
        declared = 0
        for instance_id in missing:
            if await self._realtime.declare(instance_id):
                declared += 1
        return declared

    async def _revoke_extra(self, expected: set[str], actual: set[str]) -> int:
        """清掉实例已经不在、主题还挂着的那些。

        它们谁也推不到，却仍可被订阅——客户端订上去、也没报错，就是永远收不到
        数据。

        Args: expected, actual。
        """
        revoked = 0
        for topic in sorted(actual - expected):
            if await self._realtime.revoke_topic(topic):
                revoked += 1
        return revoked
