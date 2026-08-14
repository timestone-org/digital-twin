"""组合根：把配置拧成各个协作对象。装配只在这里发生，模块顶层不做副作用。"""

from dataclasses import dataclass

from collector_server.apps.collect.archive.buffer import (
    ArchiveBuffer,
    ArchiveOptions,
)
from collector_server.apps.collect.archive.writer import (
    ArchiveWriter,
    WriterOptions,
)
from collector_server.apps.collect.bus.consumer import CommandConsumer
from collector_server.apps.collect.drivers.base import DriverTimeouts
from collector_server.apps.collect.drivers.registry import create_driver
from collector_server.apps.collect.plan.client import PlanClient
from collector_server.apps.collect.plan.store import PlanStore
from collector_server.apps.collect.runtime.session import (
    SessionOptions,
    SourceSession,
)
from collector_server.apps.collect.runtime.sink import SnapshotSink, fan_out
from collector_server.apps.collect.runtime.supervisor import (
    LEASE_KEY,
    LEASE_TTL_S,
    CollectSupervisor,
    SessionBuilder,
    SupervisorOptions,
)
from collector_server.apps.collect.schemas.plan import PlanSource
from collector_server.apps.collect.services import (
    PointHistoryService,
    SourceStateService,
)
from collector_server.commands import RedisCommandTransport
from collector_server.lease import RedisLease
from collector_server.settings import Settings
from collector_server.snapshot import RedisSnapshotStore
from collector_server.stream import RedisArchiveStream
from lib.db import Database, PoolProfile
from lib.utils.ids import uuid7

# 预算表见 runtime-resilience §3.1：连 5s、读写 3s、浏览 10s
DRIVER_TIMEOUTS = DriverTimeouts()


@dataclass(frozen=True)
class RedisFaces:
    """Redis 上的四条窄面。装配与关停都按这一组走，漏关一条就是泄一个连接池。"""

    lease: RedisLease
    snapshot: RedisSnapshotStore
    stream: RedisArchiveStream
    transport: RedisCommandTransport


@dataclass(frozen=True)
class Container:
    """一个进程内的全部长生命周期对象。"""

    settings: Settings
    database: Database
    redis: RedisFaces
    plan: PlanStore
    sink: SnapshotSink
    archive: ArchiveBuffer
    writer: ArchiveWriter
    supervisor: CollectSupervisor
    consumer: CommandConsumer


def _build_database(settings: Settings) -> Database:
    return Database(
        dsn=settings.dsn(),
        profile=PoolProfile(
            pool_size=settings.postgres_pool_size,
            max_overflow=settings.postgres_pool_overflow,
            connect_timeout_s=settings.postgres_connect_timeout_s,
            statement_timeout_ms=settings.postgres_statement_timeout_ms,
            lock_timeout_ms=settings.postgres_lock_timeout_ms,
        ),
        search_path=settings.postgres_schema,
    )


def _lease_token(settings: Settings) -> str:
    """本进程这一次运行的租约令牌。

    ⚠ 每次启动都换一个：沿用上次的令牌，会让一个刚重启的进程「续」上自己上
    一世的租约——那正是脑裂窗口里最不该发生的事。

    Args: settings。
    """
    return f"{settings.app_instance}:{uuid7()}"


def _build_session_builder(
    settings: Settings,
    sink: SnapshotSink,
    archive: ArchiveBuffer,
    state: SourceStateService,
) -> SessionBuilder:
    """造一个「按计划里的数据源产出会话」的工厂。

    Args: settings, sink, archive, state。
    """

    def build(source: PlanSource) -> SourceSession:
        return SourceSession(
            source=source,
            driver=create_driver(
                source.protocol, source.to_connection(DRIVER_TIMEOUTS)
            ),
            # 一条读数并联进快照与归档两条支线（COLLECT_DESIGN.md §4.3 的 ②③）
            sink=fan_out(
                sink.sink_for(source.source_id),
                archive.sink_for(source.source_id),
            ),
            options=SessionOptions(
                heartbeat_interval_s=settings.heartbeat_interval_s,
                max_backoff_s=settings.reconnect_max_backoff_s,
                timeouts=DRIVER_TIMEOUTS,
            ),
            reporter=state,
        )

    return build


def _build_plan(settings: Settings) -> PlanStore:
    """计划的取数与本地比对。

    Args: settings。
    """
    return PlanStore(
        fetcher=PlanClient(
            base_url=settings.platform_base_url,
            service_key=settings.edge_service_key.get_secret_value(),
            timeout_s=settings.plan_timeout_s,
        )
    )


def _build_supervisor(
    settings: Settings,
    lease: RedisLease,
    plan: PlanStore,
    builder: SessionBuilder,
) -> CollectSupervisor:
    """总控：租约 + 计划 + 会话收敛。

    Args: settings, lease, plan, builder。
    """
    return CollectSupervisor(
        lease=lease,
        plan=plan,
        builder=builder,
        options=SupervisorOptions(
            plan_refresh_interval_s=settings.plan_refresh_interval_s
        ),
    )


def _build_archive(
    settings: Settings, stream: RedisArchiveStream, plan: PlanStore
) -> ArchiveBuffer:
    """归档缓冲：准入靠计划里的逐点位参数，落 Stream 靠 `stream`。

    Args: settings, stream, plan。
    """
    return ArchiveBuffer(
        stream=stream,
        plan=plan,
        options=ArchiveOptions(
            flush_interval_ms=settings.flush_interval_ms,
            max_rows=settings.archive_buffer_max,
            batch_rows=settings.archive_batch_rows,
            stream_maxlen=settings.archive_stream_maxlen,
        ),
    )


def _build_redis(settings: Settings) -> RedisFaces:
    """Redis 上的四条窄面，各自一个连接池。

    Args: settings。
    """
    redis_url = settings.url()
    return RedisFaces(
        lease=RedisLease(
            url=redis_url,
            key=LEASE_KEY,
            token=_lease_token(settings),
            ttl_s=LEASE_TTL_S,
            timeout_s=settings.redis_timeout_s,
        ),
        snapshot=RedisSnapshotStore(
            url=redis_url, timeout_s=settings.redis_timeout_s
        ),
        stream=RedisArchiveStream(
            url=redis_url, timeout_s=settings.redis_timeout_s
        ),
        transport=RedisCommandTransport(
            url=redis_url, block_s=settings.command_block_s
        ),
    )


def _build_writer(
    settings: Settings, stream: RedisArchiveStream, database: Database
) -> ArchiveWriter:
    """落库端：Stream → TimescaleDB，写成功才删条目。

    Args: settings, stream, database。
    """
    return ArchiveWriter(
        stream=stream,
        store=PointHistoryService(
            database=database, batch_rows=settings.archive_batch_rows
        ),
        options=WriterOptions(flush_interval_ms=settings.archive_flush_ms),
    )


def build_container(settings: Settings) -> Container:
    """按配置装配容器。

    Args: settings。
    """
    database = _build_database(settings)
    redis = _build_redis(settings)
    sink = SnapshotSink(
        store=redis.snapshot,
        interval_ms=settings.flush_interval_ms,
        ttl_s=settings.snapshot_ttl_s,
    )
    plan = _build_plan(settings)
    archive = _build_archive(settings, redis.stream, plan)
    state = SourceStateService(
        database=database, instance=settings.app_instance
    )
    supervisor = _build_supervisor(
        settings,
        redis.lease,
        plan,
        _build_session_builder(settings, sink, archive, state),
    )
    return Container(
        settings=settings,
        database=database,
        redis=redis,
        plan=plan,
        sink=sink,
        archive=archive,
        writer=_build_writer(settings, redis.stream, database),
        supervisor=supervisor,
        consumer=CommandConsumer(
            transport=redis.transport,
            locator=supervisor,
            block_s=settings.command_block_s,
            reply_ttl_s=settings.command_reply_ttl_s,
        ),
    )
