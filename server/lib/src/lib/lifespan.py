"""启动/关停钩子编排。

⚠ 关停顺序**不是**启动顺序的逆序：每个钩子显式声明 `shutdown_order`，
由测试锁死（见 docs/agents/runtime-resilience.md §8）。
"""

import asyncio
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field

from lib.logging.logger import get_logger

_logger = get_logger("lib.lifespan")

AsyncAction = Callable[[], Awaitable[None]]


@dataclass(frozen=True)
class LifespanHook:
    """一个组件的启停动作。`shutdown_order` 小者先停。"""

    name: str
    startup: AsyncAction | None = None
    shutdown: AsyncAction | None = None
    startup_order: int = 100
    shutdown_order: int = 100


@dataclass
class ReadinessGate:
    """就绪闸。收到 SIGTERM 后立刻置否，让编排器先摘流量再 drain。"""

    ready: bool = False
    reason: str = "starting"

    def open(self) -> None:
        self.ready = True
        self.reason = "ok"

    def close(self, reason: str) -> None:
        self.ready = False
        self.reason = reason


@dataclass
class LifespanRunner:
    """按显式顺序跑启停钩子。"""

    hooks: Sequence[LifespanHook]
    gate: ReadinessGate = field(default_factory=ReadinessGate)
    drain_timeout_s: float = 20.0

    async def startup(self) -> None:
        """按 `startup_order` 升序执行，任一失败即向上抛。"""
        for hook in sorted(self.hooks, key=lambda item: item.startup_order):
            if hook.startup is None:
                continue
            await hook.startup()
            _logger.info("component_started", "", component=hook.name)
        self.gate.open()

    async def shutdown(self) -> None:
        """摘就绪 → 按 `shutdown_order` 升序停 → 单钩子超时不阻断其余。"""
        self.gate.close("shutting_down")
        for hook in sorted(self.hooks, key=lambda item: item.shutdown_order):
            if hook.shutdown is None:
                continue
            await self._stop_one(hook)

    async def _stop_one(self, hook: LifespanHook) -> None:
        if hook.shutdown is None:
            return
        try:
            async with asyncio.timeout(self.drain_timeout_s):
                await hook.shutdown()
        # 一个组件停不下来不该阻断其余组件让位与 flush
        except Exception as error:
            _logger.error(
                "component_stop_failed",
                "组件关停失败",
                component=hook.name,
                error=error,
            )
        else:
            _logger.info("component_stopped", "", component=hook.name)
