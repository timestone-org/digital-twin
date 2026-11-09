"""启动/关停钩子编排。

⚠ 关停顺序**不是**启动顺序的逆序：每个钩子显式声明 `shutdown_order`，
由测试锁死（见 docs/agents/runtime-resilience.md §8）。
"""

import asyncio
import signal
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from types import FrameType

from lib.logging.logger import get_logger

_logger = get_logger("lib.lifespan")

AsyncAction = Callable[[], Awaitable[None]]

# 进程该收摊了的两个信号
TERMINATION_SIGNALS = (signal.SIGTERM, signal.SIGINT)


async def wait_for_termination() -> None:
    """等 SIGTERM / SIGINT，收到即返回，由调用方按顺序收摊。"""
    loop = asyncio.get_running_loop()
    stopped = asyncio.Event()
    for number in TERMINATION_SIGNALS:
        _install_handler(loop, number, stopped)
    await stopped.wait()


def _install_handler(
    loop: asyncio.AbstractEventLoop,
    number: signal.Signals,
    stopped: asyncio.Event,
) -> None:
    """装一个信号回调；事件循环不支持就退回 stdlib 的同步 handler。

    ⚠ 只有 Unix 的事件循环实现了 `add_signal_handler`，Windows 上它直接抛
    `NotImplementedError`——不接住的话不监听端口的那几个角色一起来就崩在这里，
    而 api 角色因为走 uvicorn 自带的信号处理毫发无伤，故容器里怎么跑都看不见。
    ⚠ 退回的这条路必须经 `call_soon_threadsafe`：同步 handler 不在事件循环里
    跑，直接 `set` 既不线程安全，也叫不醒正空闲着的循环。
    Args: loop, number, stopped。
    """
    try:
        loop.add_signal_handler(number, stopped.set)
    except NotImplementedError:

        def _handle(_number: int, _frame: FrameType | None) -> None:
            loop.call_soon_threadsafe(stopped.set)

        signal.signal(number, _handle)


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
    """就绪闸。lifespan 关停一开始就置否。

    ⚠ 只有经 `create_app` 起的 HTTP 进程用它，而那里的关停由 uvicorn 驱动：
    它先停止监听、等连接收完，最后才跑 lifespan 关停，所以置否时已没有人来问
    `/ready`。它保证不了「先摘流量再停止监听」。
    """

    is_ready: bool = False
    reason: str = "starting"

    def open(self) -> None:
        self.is_ready = True
        self.reason = "ok"

    def close(self, reason: str) -> None:
        self.is_ready = False
        self.reason = reason


@dataclass
class LifespanRunner:
    """按显式顺序跑启停钩子。"""

    hooks: Sequence[LifespanHook]
    gate: ReadinessGate = field(default_factory=ReadinessGate)
    # 整个关停的总预算，不是每个钩子各一份
    drain_timeout_s: float = 20.0
    # 总预算花光后每个钩子仍保底的时长：排在最后的 flush 与让租约也要有一片
    drain_floor_s: float = 1.0

    async def startup(self) -> None:
        """按 `startup_order` 升序执行；任一失败先停掉已走过的，再向上抛。"""
        reached: list[LifespanHook] = []
        for hook in sorted(self.hooks, key=lambda item: item.startup_order):
            if hook.startup is not None:
                try:
                    await hook.startup()
                except BaseException:
                    self.gate.close("startup_failed")
                    await self._stop_all(reached)
                    raise
                _logger.info("component_started", "", component=hook.name)
            reached.append(hook)
        self.gate.open()

    async def shutdown(self) -> None:
        """摘就绪 → 按 `shutdown_order` 升序停 → 单钩子超时不阻断其余。"""
        self.gate.close("shutting_down")
        await self._stop_all(self.hooks)

    async def _stop_all(self, hooks: Sequence[LifespanHook]) -> None:
        """在同一份总预算里按 `shutdown_order` 升序逐个停。

        Args: hooks。
        """
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.drain_timeout_s
        for hook in sorted(hooks, key=lambda item: item.shutdown_order):
            budget = max(deadline - loop.time(), self.drain_floor_s)
            await self._stop_one(hook, budget)

    async def _stop_one(self, hook: LifespanHook, budget_s: float) -> None:
        if hook.shutdown is None:
            return
        try:
            async with asyncio.timeout(budget_s):
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
