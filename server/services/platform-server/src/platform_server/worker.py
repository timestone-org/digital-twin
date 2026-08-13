"""worker 角色的进程装配与关停编排。

⚠ 关停顺序是「停收新活 → drain → 让资源」，**不是启动顺序的逆序**
（docs/agents/runtime-resilience.md §8）。
"""

import asyncio
import signal
from collections.abc import Awaitable, Callable
from concurrent.futures import Executor, ProcessPoolExecutor
from dataclasses import dataclass
from typing import Protocol

from lib.logging import configure_logging, get_logger
from platform_server.apps.hvac.services.ac_model_worker import (
    TrainerOptions,
    TrainingConsumer,
)
from platform_server.apps.hvac.services.ac_source_reader import AcSourceReader
from platform_server.apps.hvac.services.ac_startup_extract import (
    ExtractionContext,
)
from platform_server.apps.hvac.services.ac_startup_rules import ExtractionRules
from platform_server.apps.hvac.services.ac_startup_worker import (
    ConsumerOptions,
    ShardConsumer,
)
from platform_server.container import Container, build_container
from platform_server.settings import Settings
from platform_server.stream import StreamGroup

_logger = get_logger("platform.worker")

Wait = Callable[[], Awaitable[None]]


class Consumer(Protocol):
    """一条消费循环的最小面：跑、停收新活、等手上那条跑完。"""

    async def run(self) -> None: ...

    def stop(self) -> None: ...

    async def drain(self, timeout_s: float) -> None: ...


@dataclass(frozen=True)
class WorkerRuntime:
    """一次 worker 运行：跑什么、等什么信号、到点关谁。"""

    consumers: tuple[Consumer, ...]
    container: Container
    wait: Wait


def build_consumer(container: Container) -> ShardConsumer:
    """按配置装出分片消费者。

    Args: container。
    """
    settings = container.settings
    return ShardConsumer(
        database=container.database,
        stream=container.stream,
        context=ExtractionContext(
            reader=AcSourceReader(
                source=container.ac_source,
                timezone=settings.acsource_timezone,
            ),
            rules=ExtractionRules(),
            max_rows=settings.acstartup_max_rows,
        ),
        options=ConsumerOptions(
            target=StreamGroup(
                stream=settings.acstartup_stream,
                group=settings.acstartup_group,
                consumer=settings.app_instance,
            ),
            prefetch=settings.acstartup_prefetch,
            block_ms=settings.acstartup_block_ms,
            claim_idle_ms=settings.acstartup_claim_idle_ms,
            shard_timeout_s=settings.acstartup_shard_timeout_s,
        ),
    )


def build_trainer(
    container: Container, *, executor: Executor
) -> TrainingConsumer:
    """按配置装出训练消费者。

    Args: container, executor（⚠ 必须是进程池：拟合是 CPU 密集，线程池救
    不了 GIL，会把同一事件循环上的分片消费一起卡住）。
    """
    settings = container.settings
    return TrainingConsumer(
        database=container.database,
        stream=container.stream,
        executor=executor,
        options=TrainerOptions(
            target=StreamGroup(
                stream=settings.acmodel_stream,
                group=settings.acmodel_group,
                consumer=settings.app_instance,
            ),
            prefetch=settings.acmodel_prefetch,
            block_ms=settings.acmodel_block_ms,
            claim_idle_ms=settings.acmodel_claim_idle_ms,
            train_timeout_s=settings.acmodel_train_timeout_s,
            timezone=settings.acsource_timezone,
        ),
    )


async def selfcheck(container: Container) -> None:
    """启动自检：把依赖可达性写进日志，不可达不阻断启动。

    ⚠ worker 不挂就绪探针：它不接流量，「摘掉它」没有意义，能不能干活由队列的
    待确认表说话。
    Args: container。
    """
    settings = container.settings
    _logger.info(
        "worker_selfcheck",
        "worker 依赖自检",
        postgres=settings.postgres_target(),
        redis=settings.redis_target(),
        is_postgres_reachable=await container.database.ping(),
        is_redis_reachable=await container.stream.ping(),
    )


async def run_until_stopped(
    runtime: WorkerRuntime, *, drain_timeout_s: float
) -> None:
    """跑起全部消费循环，收到信号后按顺序收摊。

    ⚠ 顺序不能换：先停收新活，再等手上那条跑完，最后才关连接池。反过来会让
    在途任务拿着一个已经关掉的连接池，跑到一半失败而消息已经确认。
    Args: runtime, drain_timeout_s。
    """
    tasks = [
        asyncio.create_task(consumer.run()) for consumer in runtime.consumers
    ]
    try:
        await runtime.wait()
    finally:
        # 1 停收新活 → 2 drain 并行等各自手上那条跑完（墙钟取最慢的一条）
        for consumer in runtime.consumers:
            consumer.stop()
        await asyncio.gather(
            *(consumer.drain(drain_timeout_s) for consumer in runtime.consumers)
        )
        for task in tasks:
            task.cancel()
        # 3 让资源：队列 → 外库 → 连接池，连接池最后关
        await _release(runtime.container)
    _logger.info("worker_stopped", "worker 已退出")


async def _release(container: Container) -> None:
    """关掉长生命周期资源。连接池最后关：前面几件收尾时还要用它。

    Args: container。
    """
    await container.stream.close()
    await container.ac_source.dispose()
    await container.database.dispose()


async def serve(settings: Settings, *, wait: Wait) -> None:
    """装配并跑到收到终止信号为止。

    Args: settings, wait。
    """
    container = build_container(settings)
    await selfcheck(container)
    # 单 worker 进程池：训练一次只跑一个，防止两次训练互相抢核
    executor = ProcessPoolExecutor(max_workers=1)
    try:
        await run_until_stopped(
            WorkerRuntime(
                consumers=(
                    build_consumer(container),
                    build_trainer(container, executor=executor),
                ),
                container=container,
                wait=wait,
            ),
            drain_timeout_s=settings.app_drain_timeout_s,
        )
    finally:
        executor.shutdown(wait=False, cancel_futures=True)


async def wait_for_signal() -> None:  # pragma: no cover - 要真实进程信号
    """等 SIGTERM / SIGINT。收到即返回，由调用方按顺序收摊。"""
    loop = asyncio.get_running_loop()
    stopped = asyncio.Event()
    for name in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(name, stopped.set)
    await stopped.wait()


def run(settings: Settings) -> None:  # pragma: no cover - 进程入口
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
    asyncio.run(serve(settings, wait=wait_for_signal))
