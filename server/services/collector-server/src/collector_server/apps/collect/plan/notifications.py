"""监听采集计划变更通知，唤醒 supervisor 全量重拉。"""

import asyncio
from collections.abc import Callable
from contextlib import suppress

from lib.cache import PubSub
from lib.errors import DependencyUnavailable
from lib.logging import get_logger

_logger = get_logger("collect.plan.notifications")
RESUBSCRIBE_DELAY_S = 1.0


class PlanNotifications:
    """监听配置面广播，订阅短暂断开时仍由定时拉取兜底。"""

    def __init__(
        self, *, pubsub: PubSub, channel: str, refresh: Callable[[], None]
    ) -> None:
        self._pubsub = pubsub
        self._channel = channel
        self._refresh = refresh
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        """启动监听任务。"""
        self._task = asyncio.create_task(self._listen())

    async def stop(self) -> None:
        """停止监听并关闭连接池。"""
        task, self._task = self._task, None
        try:
            if task is not None:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
        finally:
            await self._pubsub.close()

    async def _listen(self) -> None:
        while True:
            try:
                async for _, _ in self._pubsub.listen((self._channel,)):
                    self._refresh()
            except DependencyUnavailable:
                _logger.warning(
                    "plan_subscription_unavailable",
                    "计划通知订阅暂不可用，继续定时拉取采集计划",
                )
                await asyncio.sleep(RESUBSCRIBE_DELAY_S)
