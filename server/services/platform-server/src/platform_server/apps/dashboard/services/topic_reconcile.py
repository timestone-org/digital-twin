"""主题登记的对账：把 hub 那边的主题拉回与大屏表一致。

主题是**旁路数据**：大屏表在本服务的库里，主题清单在 hub 的库里，中间隔着
一次跨服务调用。两边都可能漂：

- 大屏建了而 hub 当时不可达 → 主题**缺**。表现最恶劣：页面一切正常，订阅被
  hub 以「主题未登记」拒掉，那张大屏永远没有实时值。
- 大屏删了而 hub 当时不可达 → 主题**多**。留下一个谁也推不到、却仍订得上的
  空主题。

⚠ ADR-0007 要求「注销按 at-least-once 处理，且必须有一条对账，不允许静默
失败」——本文件就是那条对账。它**按周期跑**而不是只在启动时跑：新建大屏的
主题也由它登记，因此这个周期同时是「新建的大屏多久之后可被订阅」的上界。
"""

import uuid

from lib.logging import get_logger
from platform_server.apps.dashboard.services.publish_plan import (
    DashboardIndex,
)
from platform_server.apps.dashboard.services.topics import (
    PUBLISHER_NAME,
    TOPIC_REQUIRED_CODE,
    topic_of,
)
from platform_server.realtime import TopicRegistrar

_logger = get_logger("platform.dashboard.topics")


class TopicReconciler:
    """让 hub 上的主题与大屏表对齐。"""

    def __init__(
        self, *, dashboards: DashboardIndex, realtime: TopicRegistrar
    ) -> None:
        """按大屏清单与 hub 客户端初始化。

        Args: dashboards, realtime。
        """
        self._dashboards = dashboards
        self._realtime = realtime

    async def reconcile(self) -> tuple[int, int]:
        """补齐缺的、注销多的，返回 (补了几个, 注销了几个)。

        ⚠ 只把**本服务的大屏表**当权威：hub 不认识大屏，它那份主题清单是我们
        推过去的投影。反过来拿 hub 的清单去改大屏表，就是把通道服务当成了业务
        真源。
        ⚠ 单条失败不重试也不抛：下一轮还会再对一次。这一层重试会与「hub 正在
        重启」撞在一起，把一拍拖成一串超时。
        """
        live = await self._dashboards.live_ids()
        expected = {topic_of(dashboard_id) for dashboard_id in live}
        actual = set(await self._realtime.topics(PUBLISHER_NAME))
        declared = await self._declare_missing(live, actual)
        revoked = await self._revoke_extra(expected, actual)
        _logger.info(
            "dashboard_topics_reconciled",
            "大屏主题对账完成",
            dashboards=len(live),
            declared=declared,
            revoked=revoked,
        )
        return declared, revoked

    async def _declare_missing(
        self, live: list[uuid.UUID], actual: set[str]
    ) -> int:
        """给 hub 上缺的大屏补登记。

        Args: live, actual。
        """
        missing = [
            dashboard_id
            for dashboard_id in live
            if topic_of(dashboard_id) not in actual
        ]
        declared = 0
        for dashboard_id in missing:
            is_declared = await self._realtime.declare(
                topic=topic_of(dashboard_id),
                required_code=TOPIC_REQUIRED_CODE,
                publisher=PUBLISHER_NAME,
            )
            declared += int(is_declared)
        return declared

    async def _revoke_extra(self, expected: set[str], actual: set[str]) -> int:
        """注销大屏已经不在、主题还挂着的那些。

        ⚠ 方向单向：以 hub 的清单为输入。取不到清单时输入为空，于是什么都不
        注销——宁可多留一个空主题，也不要因为一次超时把全量主题清光。
        Args: expected, actual。
        """
        revoked = 0
        for topic in sorted(actual - expected):
            revoked += int(await self._realtime.revoke(topic))
        return revoked
