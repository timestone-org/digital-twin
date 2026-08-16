"""计划的本地缓存与版本比对。

⚠ 只在**进程内存**里，不落盘：重启后拿不到计划就空转，不许用上次的猜——
用错的计划采数据比不采更糟，它会写出看似正常的错误历史（ADR-0001）。
"""

from typing import Protocol

from collector_server.apps.collect.errors import PlanUnavailable
from collectwire import CollectPlan
from lib.logging import get_logger

_logger = get_logger("collect.plan.store")


class PlanFetcher(Protocol):
    """拉一次全量计划的最小面。真实现是 `PlanClient`。"""

    async def fetch(self) -> CollectPlan: ...


class PlanStore:
    """当前生效的计划。版本没变就什么都不做。"""

    def __init__(self, *, fetcher: PlanFetcher) -> None:
        """按取数面初始化，构造时不做 IO。

        Args: fetcher。
        """
        self._fetcher = fetcher
        self._plan: CollectPlan | None = None
        self._consecutive_failures = 0

    @property
    def current(self) -> CollectPlan | None:
        """当前生效的计划；从没拉到过就是 None。"""
        return self._plan

    @property
    def consecutive_failures(self) -> int:
        """连续拉取失败的次数。持续大于零就是一次要人看的告警。"""
        return self._consecutive_failures

    async def refresh(self) -> bool:
        """拉一次并比对版本，返回「是否需要重新收敛」。

        ⚠ 拉失败时**不抛**：调用方是主循环，抛出去只会让循环退出。降级方向
        是保持上一份**已经生效**的计划继续采，并每次都响亮告警——那不是
        「用过期缓存猜」，而是「platform 还没说要改」。真正禁止的是启动期
        没拿到计划却拿旧的顶上，那种情况这里的 `current` 就是 None。
        """
        try:
            fetched = await self._fetcher.fetch()
        except PlanUnavailable:
            self._consecutive_failures += 1
            _logger.error(
                "plan_unavailable",
                "拿不到采集计划",
                consecutive_failures=self._consecutive_failures,
                has_plan=self._plan is not None,
            )
            return False
        self._consecutive_failures = 0
        if self._plan is not None and self._plan.version == fetched.version:
            return False
        self._plan = fetched
        _logger.info(
            "plan_applied",
            "采集计划已更新",
            plan_version=fetched.version,
            source_count=len(fetched.sources),
        )
        return True
