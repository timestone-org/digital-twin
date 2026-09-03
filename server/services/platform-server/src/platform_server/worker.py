"""worker 角色的进程装配与关停编排。

⚠ 关停顺序是「停收新活 → drain → 让资源」，**不是启动顺序的逆序**
（docs/agents/runtime-resilience.md §8）。
"""

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol
from zoneinfo import ZoneInfo

from lib.lifespan import wait_for_termination
from lib.logging import configure_logging, get_logger
from lib.stream import StreamGroup
from platform_server.apps.assets.services.compress_worker import (
    CompressConsumer,
    CompressOptions,
    ModelCompressor,
)
from platform_server.apps.dataset.services import register_provider
from platform_server.apps.dataset.services.collector import (
    CollectorContext,
    DatasetCollector,
)
from platform_server.apps.dataset.services.retention import (
    DatasetRetention,
    RetentionAnchor,
    RetentionContext,
)
from platform_server.apps.hvac.services.ac_daily_worker import (
    DailyConsumer,
    DailyConsumerOptions,
    DailyScheduler,
    SchedulerOptions,
)
from platform_server.apps.hvac.services.ac_model_worker import (
    TrainerOptions,
    TrainerPool,
    TrainingConsumer,
)
from platform_server.apps.hvac.services.ac_publish_worker import (
    PublishLoop,
    PublishLoopOptions,
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
from platform_server.apps.modeling.services import (
    NodePool,
    RunConsumer,
    RunConsumerOptions,
)
from platform_server.apps.modeling.services.model_provider import (
    ModelingAnalysisProvider,
)
from platform_server.apps.modeling.services.retention import (
    ModelingRetention,
    RetentionOptions,
)
from platform_server.container import Container, build_container
from platform_server.settings import Settings

_logger = get_logger("platform.worker")

# 一天与一分钟的秒数，清理周期与时区偏移换算用
_DAY_S = 86400.0
_MINUTE_S = 60

Wait = Callable[[], Awaitable[None]]


class Consumer(Protocol):
    """一条消费循环的最小面：跑、停收新活、等手上那条跑完。"""

    async def run(self) -> None: ...

    def stop(self) -> None: ...

    async def drain(self, timeout_s: float) -> None: ...


class LeaseHolder(Protocol):
    """持着单活租约的那些循环：关停时要主动让位。"""

    async def release(self) -> None: ...


@dataclass(frozen=True)
class WorkerRuntime:
    """一次 worker 运行：跑什么、等什么信号、到点关谁。"""

    consumers: tuple[Consumer, ...]
    # ⚠ 与 `consumers` 有重叠：持租约的循环同时也是消费循环。分开列是因为
    # 关停时它们多一步「让租约」，而那一步的位置是硬约束（见 run_until_stopped）
    leaseholders: tuple[LeaseHolder, ...]
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
        context=_extraction_context(container),
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


def build_model_compressor(container: Container) -> CompressConsumer:
    """按配置装出模型压缩消费者。

    ⚠ 压缩真正跑在 Node 子进程里（Python 没有可用的 glTF Draco 编码器，
    ADR-0022），故这条循环本身不吃 CPU，与其它消费循环共用事件循环无碍。
    Args: container。
    """
    settings = container.settings
    options = CompressOptions(
        target=StreamGroup(
            stream=settings.assetcompress_stream,
            group=settings.assetcompress_group,
            consumer=settings.app_instance,
        ),
        script=Path(settings.assetcompress_script),
        node=settings.assetcompress_node,
    )
    return CompressConsumer(
        stream=container.stream,
        compressor=ModelCompressor(
            database=container.database,
            store=container.object_store,
            options=options,
        ),
        options=options,
    )


def build_trainer(
    container: Container, *, pool: TrainerPool
) -> TrainingConsumer:
    """按配置装出训练消费者。

    Args: container, pool（⚠ 必须是进程池：拟合是 CPU 密集，线程池救不了
    GIL，会把同一事件循环上的分片消费一起卡住）。
    """
    settings = container.settings
    return TrainingConsumer(
        database=container.database,
        stream=container.stream,
        pool=pool,
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


def build_modeling_runner(
    container: Container, *, pool: NodePool
) -> RunConsumer:
    """按配置装出建模运行的消费者。

    Args: container, pool（⚠ 必须是进程池：算子拟合是 CPU 密集，线程池救不了
    GIL，会把同一事件循环上的其它消费循环一起卡住）。
    """
    settings = container.settings
    return RunConsumer(
        sessions=container.database,
        stream=container.stream,
        pool=pool,
        options=RunConsumerOptions(
            store=container.object_store,
            target=StreamGroup(
                stream=settings.modeling_stream,
                group=settings.modeling_group,
                consumer=settings.app_instance,
            ),
            prefetch=settings.modeling_prefetch,
            block_ms=settings.modeling_block_ms,
            claim_idle_ms=settings.modeling_claim_idle_ms,
            node_timeout_s=settings.modeling_node_timeout_s,
            tz_offset_minutes=_business_tz_offset_minutes(container),
        ),
    )


def build_modeling_retention(container: Container) -> ModelingRetention:
    """按配置装出建模的保留期清理循环。

    ⚠ 它不持租约：删的是「按流水线的老运行」与「过期的运行行」，两台一起删也
    只是各自删到一部分，没有互相踩的写。
    Args: container。
    """
    settings = container.settings
    return ModelingRetention(
        sessions=container.database,
        options=RetentionOptions(
            keep_per_pipeline=settings.modeling_run_keep_per_pipeline,
            retention_days=settings.modeling_run_retention_days,
            stale_minutes=settings.modeling_stale_minutes,
            interval_s=_DAY_S,
        ),
    )


def _business_tz_offset_minutes(container: Container) -> int:
    """业务时区相对 UTC 的分钟偏移。

    ⚠ 时间特征按 UTC 算会整体偏 8 小时，且不报任何错。
    Args: container。
    """
    zone = ZoneInfo(container.settings.dataset_bucket_timezone)
    offset = datetime.now(UTC).astimezone(zone).utcoffset()
    return 0 if offset is None else int(offset.total_seconds() // _MINUTE_S)


def build_publish_loop(container: Container) -> PublishLoop:
    """按配置装出预测下发循环。

    ⚠ 它与另两条消费循环并列跑在同一个事件循环上，故每一段都必须有超时：
    一次卡住的外库查询会把分片消费与训练消费一起拖住。

    Args: container。
    """
    settings = container.settings
    return PublishLoop(
        database=container.database,
        lease=container.ac_publish_lease,
        reader=AcSourceReader(
            source=container.ac_source, timezone=settings.acsource_timezone
        ),
        nodes=container.nodes,
        options=PublishLoopOptions(
            interval_s=settings.acpublish_interval_s,
            budget_s=settings.acpublish_budget_s,
            model_timeout_s=settings.acpublish_model_timeout_s,
        ),
    )


def build_dataset_collector(container: Container) -> DatasetCollector:
    """按配置装出台账聚合采集循环。

    ⚠ 它没有「节奏」形参：总开关、节拍与三个上限全部在**每一拍**里从运行参数
    表现读，界面上一改下一拍就生效（docs/DATASET_DESIGN.md §13）。启动时抄一份
    的话，运维关掉开关之后还要重启一次进程才停得下来。
    Args: container。
    """
    return DatasetCollector(
        context=CollectorContext(
            database=container.database,
            # ⚠ 走归档库自己的只读池：一次跨月的时序扫描不该把台账的写连接
            # 连同它持有的锁一起占住（ADR-0003 写独占读放行）
            history=container.history,
            dirty=container.dataset.dirty,
            settings=container.settings,
        ),
        lease=container.dataset.lease,
    )


def build_dataset_retention(container: Container) -> DatasetRetention:
    """按配置装出台账保留期清理循环。

    ⚠ 它与聚合采集器**各持一把租约**：共用一把会让「今晚采不采」顺带决定
    「今晚清不清」，而两条循环的节奏差着三个量级（一分钟 vs 一天）。
    ⚠ 同样没有「节奏」形参：总开关、周期与两个上限全部在**每一趟**里从运行
    参数表现读（docs/DATASET_DESIGN.md §15）。
    Args: container。
    """
    return DatasetRetention(
        context=RetentionContext(
            database=container.database,
            # 执行锚点落在 Redis 上：它要挡的正是「进程重启把节奏清零」
            anchor=RetentionAnchor(store=container.cache),
            dirty=container.dataset.dirty,
            settings=container.settings,
        ),
        lease=container.dataset.retention_lease,
    )


def build_daily_scheduler(container: Container) -> DailyScheduler:
    """按配置装出日增量的调度器。**它只入队，抽取在消费者那边。**

    Args: container。
    """
    settings = container.settings
    return DailyScheduler(
        database=container.database,
        stream=container.stream,
        lease=container.ac_daily_lease,
        options=SchedulerOptions(
            target=_daily_target(container),
            interval_s=settings.acdaily_scheduler_interval_s,
            timezone=settings.acsource_timezone,
        ),
    )


def build_daily_consumer(container: Container) -> DailyConsumer:
    """按配置装出日增量的消费者。

    Args: container。
    """
    settings = container.settings
    return DailyConsumer(
        database=container.database,
        stream=container.stream,
        context=_extraction_context(container),
        options=DailyConsumerOptions(
            target=_daily_target(container),
            prefetch=settings.acdaily_prefetch,
            block_ms=settings.acdaily_block_ms,
            claim_idle_ms=settings.acdaily_claim_idle_ms,
            run_timeout_s=settings.acdaily_timeout_s,
            timezone=settings.acsource_timezone,
        ),
    )


def _daily_target(container: Container) -> StreamGroup:
    """日增量流的消费组坐标。

    Args: container。
    """
    settings = container.settings
    return StreamGroup(
        stream=settings.acdaily_stream,
        group=settings.acdaily_group,
        consumer=settings.app_instance,
    )


def _extraction_context(container: Container) -> ExtractionContext:
    """抽取要用的协作对象与参数。分片与日增量共用同一份。

    Args: container。
    """
    settings = container.settings
    return ExtractionContext(
        reader=AcSourceReader(
            source=container.ac_source, timezone=settings.acsource_timezone
        ),
        rules=ExtractionRules(),
        max_rows=settings.acstartup_max_rows,
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

    ⚠ 顺序不能换：先停收新活，再等手上那条跑完，然后让租约，最后才关连接池。
    反过来会让在途任务拿着一个已经关掉的连接池，跑到一半失败而消息已经确认；
    而让租约排在关资源**之前**，是因为让位要连得上 Redis——排在后面就只能等它
    自然过期，接任的副本白等一整个 TTL。让租约排在 drain **之后**，是因为
    让位时手上那一拍必须已经写完，否则接任者会与我们同时往一个点位写。
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
        # 3 让租约（要连得上 Redis，故排在关资源之前）
        for holder in runtime.leaseholders:
            await holder.release()
        # 4 让资源：队列 → 外库 → 连接池，连接池最后关
        await _release(runtime.container)
    _logger.info("worker_stopped", "worker 已退出")


async def _release(container: Container) -> None:
    """关掉长生命周期资源。连接池最后关：前面几件收尾时还要用它。

    Args: container。
    """
    await container.stream.close()
    await container.nodes.close()
    await container.ac_publish_lease.close()
    await container.ac_daily_lease.close()
    await container.dataset.lease.close()
    await container.dataset.retention_lease.close()
    await container.ac_source.dispose()
    await container.database.dispose()


async def serve(settings: Settings, *, wait: Wait) -> None:
    """装配并跑到收到终止信号为止。

    Args: settings, wait。
    """
    container = build_container(settings)
    # ⚠ worker 也要注册：回填与重算跑在这里
    register_provider(ModelingAnalysisProvider())
    await selfcheck(container)
    # 单 worker 进程池：训练一次只跑一个，防止两次训练互相抢核
    pool = TrainerPool()
    # 建模的算子池与它分开：一次训练跑几分钟，共用一个池的话建模会被空调训练
    # 整个堵住，而两边的超时口径也不一样
    node_pool = NodePool()
    publisher = build_publish_loop(container)
    scheduler = build_daily_scheduler(container)
    collector = build_dataset_collector(container)
    retention = build_dataset_retention(container)
    try:
        await run_until_stopped(
            WorkerRuntime(
                consumers=(
                    build_consumer(container),
                    build_trainer(container, pool=pool),
                    publisher,
                    scheduler,
                    build_daily_consumer(container),
                    build_model_compressor(container),
                    collector,
                    retention,
                    build_modeling_runner(container, pool=node_pool),
                    build_modeling_retention(container),
                ),
                leaseholders=(publisher, scheduler, collector, retention),
                container=container,
                wait=wait,
            ),
            drain_timeout_s=settings.app_drain_timeout_s,
        )
    finally:
        pool.shutdown()
        node_pool.shutdown()


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
    asyncio.run(serve(settings, wait=wait_for_termination))
