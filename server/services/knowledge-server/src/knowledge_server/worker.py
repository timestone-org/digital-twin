"""worker 角色的进程装配与关停编排。

⚠ 关停顺序是「停收新活 → drain → 让资源」，**不是启动顺序的逆序**
（docs/agents/runtime-resilience.md §8）。

⚠ worker **不挂就绪探针也不开 HTTP**：它不接流量，「摘掉它」没有意义，
能不能干活由队列深度与日志说话。
"""

import asyncio
from collections.abc import Awaitable, Callable
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from typing import Protocol

from knowledge_server.apps.knowledge.services.capability import (
    keyword_choice,
    vector_choice,
)
from knowledge_server.apps.knowledge.services.indexing import build_indexes
from knowledge_server.apps.knowledge.services.ingest_pipeline import (
    IngestDeps,
)
from knowledge_server.apps.knowledge.services.ingest_worker import (
    ConsumerOptions,
    IngestConsumer,
)
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
    # 解析用的进程池。⚠ 只有 worker 角色有它：api 角色一行解析都不跑，
    # 给它开一个池子等于白占一份内存
    pool: ProcessPoolExecutor | None = None


def build_runtime(container: Container, wait: Wait) -> WorkerRuntime:
    """按已经探测过的容器装出这一次要跑的消费循环。

    ⚠ 消费者是一个显式元组，不靠 import 副作用登记：隐式登记让「这个进程在跑
    什么」取决于 import 顺序，而顺序在测试里与生产里可以不同。

    ⚠ 解析走**进程池**而不是线程池：解析是纯 CPU 的活，线程池救不了 GIL——
    池里跑着一份 xlsx 时，整条消费循环连同健康探针一起冻住。

    ⚠ 池子**单工**（`max_workers=1`）：一份文档解到一半吃满内存是常事，
    并行两份的峰值内存翻倍，而 worker 的内存上限是编排给的。要更快就多起
    一个 worker 副本——那是队列消费组本来就支持的。

    ⚠ 收的是**已经探测过的**容器而不是配置：消费者在装配那一刻就要知道走哪一
    档索引，自己再造一份容器的话拿到的永远是回退档，而 `/capabilities` 报的是
    加速档——两边都不报错。

    Args: container（已经跑过 `probe_indexes`）, wait（等停止信号，
        测试换一个立刻返回的）。
    """
    pool = ProcessPoolExecutor(max_workers=1)
    return WorkerRuntime(
        consumers=(_ingest_consumer(container, pool),),
        container=container,
        wait=wait,
        pool=pool,
    )


def _ingest_consumer(
    container: Container, pool: ProcessPoolExecutor
) -> IngestConsumer:
    """装出摄取消费者。

    ⚠ 索引档按**启动探测**选，与 `/capabilities` 报的是同一份判定
    （`capability.py`）。各算各的话，界面说走加速档而写入走的是回退档——
    那时两边都不报错。

    Args: container, pool。
    """
    settings = container.settings
    vector, _reason = vector_choice(settings, container.index)
    keyword, _keyword_reason = keyword_choice(settings, container.index)
    return IngestConsumer(
        stream=container.stream,
        database=container.database,
        deps=IngestDeps(
            sources=container.sources,
            embedder=container.embedder,
            indexes=build_indexes(vector, keyword),
            pool=pool,
            parse_timeout_s=settings.parse_timeout_s,
            batch_size=settings.embedding_batch_size,
        ),
        options=ConsumerOptions(
            target=container.ingest_group(),
            block_ms=settings.ingest_block_ms,
            batch=settings.ingest_batch,
            claim_idle_ms=settings.ingest_claim_idle_ms,
        ),
    )


async def run_until_stopped(runtime: WorkerRuntime) -> None:
    """把消费循环全跑起来，等停止信号，然后按顺序收摊。

    Args: runtime。
    """
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
    if runtime.pool is not None:
        # ⚠ 不等在跑的那一个：`ProcessPoolExecutor` 没有公开的「杀掉在跑任务」
        # 的口，而 drain 已经等过一轮了。再等下去只会让编排器的强杀先到
        runtime.pool.shutdown(wait=False, cancel_futures=True)
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
    # ⚠ 探测排在装配之前，理由见 `build_runtime` 的告诫
    container = build_container(settings)
    await probe_indexes(container.database, container.index)
    await run_until_stopped(build_runtime(container, wait_for_termination))
