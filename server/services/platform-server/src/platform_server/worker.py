"""worker 角色的进程装配与关停编排。

⚠ 关停顺序是「停收新活 → drain → 让资源」，**不是启动顺序的逆序**
（docs/agents/runtime-resilience.md §8）。
"""

import asyncio
import signal
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from lib.logging import configure_logging, get_logger
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


@dataclass(frozen=True)
class WorkerRuntime:
    """一次 worker 运行：跑什么、等什么信号、到点关谁。"""

    consumer: ShardConsumer
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
    """跑起消费循环，收到信号后按顺序收摊。

    ⚠ 顺序不能换：先停收新活，再等手上那条跑完，最后才关连接池。反过来会让
    在途那一片拿着一个已经关掉的连接池，跑到一半失败而消息已经确认。
    Args: runtime, drain_timeout_s。
    """
    task = asyncio.create_task(runtime.consumer.run())
    try:
        await runtime.wait()
    finally:
        # 1 停收新活 → 2 drain 等手上那条跑完
        runtime.consumer.stop()
        await runtime.consumer.drain(drain_timeout_s)
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
    await run_until_stopped(
        WorkerRuntime(
            consumer=build_consumer(container),
            container=container,
            wait=wait,
        ),
        drain_timeout_s=settings.app_drain_timeout_s,
    )


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
