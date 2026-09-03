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

from knowledge_server.apps.knowledge.services.assembly import index_pair
from knowledge_server.apps.knowledge.services.ingest_pipeline import (
    IngestDeps,
)
from knowledge_server.apps.knowledge.services.ingest_worker import (
    ConsumerOptions,
    IngestConsumer,
)
from knowledge_server.container import Container, build_container
from knowledge_server.schema import read_schema_facts
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
    """按容器装出这一次要跑的消费循环。

    ⚠ 消费者是一个显式元组，不靠 import 副作用登记：隐式登记让「这个进程在跑
    什么」取决于 import 顺序，而顺序在测试里与生产里可以不同。

    ⚠ 解析走**进程池**而不是线程池：解析是纯 CPU 的活，线程池救不了 GIL——
    池里跑着一份 xlsx 时，整条消费循环连同健康探针一起冻住。

    ⚠ 池子**单工**（`max_workers=1`）：一份文档解到一半吃满内存是常事，
    并行两份的峰值内存翻倍，而 worker 的内存上限是编排给的。要更快就多起
    一个 worker 副本——那是队列消费组本来就支持的。

    ⚠ 收的是容器而不是配置：模型目录、嵌入档与队列客户端都是一个进程一份的
    长生命周期对象，自己再造一份的话，刷新与断路器各算各的。

    Args: container, wait（等停止信号，测试换一个立刻返回的）。
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

    ⚠ 把目录的刷新口子交给管线：`can_embed` 问的是手上那份快照，而这个进程
    里没有别的地方刷它（api 那一侧有启动钩子与能力面，worker 一个都没有）。
    不接的话每一份文档都会跳过嵌入走到 ready，而界面上说的是「已接」。

    Args: container, pool。
    """
    settings = container.settings
    return IngestConsumer(
        stream=container.stream,
        database=container.database,
        deps=IngestDeps(
            sources=container.sources,
            embedder=container.embedder,
            indexes=index_pair(settings, container.schema),
            pool=pool,
            store=container.objectstore,
            parse_timeout_s=settings.parse_timeout_s,
            batch_size=settings.embedding_batch_size,
            chunk_min_tokens=settings.chunk_min_tokens,
            chunk_overlap_chars=settings.chunk_overlap_chars,
            refresh=container.catalog.refresh,
            external_parsers=container.external_parsers,
            external_parse_timeout_s=settings.external_parse_timeout_s,
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
    container = build_container(settings)
    # ⚠ 读事实排在装配之前：消费者在装配那一刻就要知道向量列是多少维，
    # 之后再读的话它手上那份索引比的仍是配置值
    await read_schema_facts(container.database, container.schema)
    await run_until_stopped(build_runtime(container, wait_for_termination))
