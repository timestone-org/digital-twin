"""worker 角色的进程装配与关停编排。

⚠ 关停顺序是「停收新活 → drain → 让资源」，**不是启动顺序的逆序**
（docs/agents/runtime-resilience.md §8）。

⚠ worker **不挂就绪探针也不开 HTTP**：它不接流量，「摘掉它」没有意义，
能不能干活由队列深度与日志说话。
"""

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Protocol

from knowledge_server.container import Container, build_container
from knowledge_server.probe import probe_indexes
from knowledge_server.settings import Settings
from lib.lifespan import wait_for_termination
from lib.logging import configure_logging, get_logger

_logger = get_logger("knowledge.worker")

Wait = Callable[[], Awaitable[None]]

# 收到停止信号后，最多等手上那条活跑完多久。⚠ 比一份文档的解析超时短：
# 等满一次解析等于让编排器的强杀先到，而那会把这份文档留在 `parsing` 上
DRAIN_TIMEOUT_S = 30.0


class Consumer(Protocol):
    """一条消费循环的最小面：跑、停收新活、等手上那条跑完。"""

    async def run(self) -> None: ...

    def stop(self) -> None: ...

    async def drain(self, timeout_s: float) -> None: ...


@dataclass(frozen=True)
class WorkerRuntime:
    """一次 worker 运行：跑什么、等什么信号。"""

    consumers: tuple[Consumer, ...]
    container: Container
    wait: Wait


def build_runtime(settings: Settings, wait: Wait) -> WorkerRuntime:
    """按配置装出这一次要跑的消费循环。

    ⚠ 消费者是一个显式元组，不靠 import 副作用登记：隐式登记让「这个进程在跑
    什么」取决于 import 顺序，而顺序在测试里与生产里可以不同。

    Args: settings, wait（等停止信号，测试换一个立刻返回的）。
    """
    return WorkerRuntime(
        consumers=(),
        container=build_container(settings),
        wait=wait,
    )


async def run_until_stopped(runtime: WorkerRuntime) -> None:
    """把消费循环全跑起来，等停止信号，然后按顺序收摊。

    Args: runtime。
    """
    await probe_indexes(runtime.container)
    tasks = [
        asyncio.create_task(one.run(), name=type(one).__name__)
        for one in runtime.consumers
    ]
    _logger.info("worker_started", "摄取循环已就绪", loops=len(tasks))
    try:
        await runtime.wait()
    finally:
        await _shutdown(runtime, tasks)


async def _shutdown(
    runtime: WorkerRuntime, tasks: list[asyncio.Task[None]]
) -> None:
    """停收新活 → drain → 收资源。

    ⚠ 先 `stop()` 再 drain：反过来的话，drain 期间还在不停地取新消息，
    而那条循环永远排不空。

    Args: runtime, tasks。
    """
    for one in runtime.consumers:
        one.stop()
    for one in runtime.consumers:
        await one.drain(DRAIN_TIMEOUT_S)
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    await runtime.container.cache.close()
    await runtime.container.database.dispose()
    _logger.info("worker_stopped", "摄取循环已收摊")


async def run_worker(settings: Settings) -> None:
    """worker 角色的入口。

    Args: settings。
    """
    configure_logging(
        service=settings.app_name,
        role=settings.app_role,
        instance=settings.app_instance,
        level=settings.app_log_level,
        log_format=settings.app_log_format,
    )
    await run_until_stopped(build_runtime(settings, wait_for_termination))
