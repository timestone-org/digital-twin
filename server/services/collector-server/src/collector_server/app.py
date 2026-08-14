"""装配本服务的 FastAPI 实例。

⚠ **无业务 HTTP 面**：这里只有 `/health` 与 `/ready`。采集的输入是计划
（内部 HTTP）与命令总线（Redis），输出是快照与 `collect` schema。
"""

from fastapi import FastAPI

from collector_server.apps.collect.runtime.reachability import (
    unreachable_codes,
)
from collector_server.container import Container, build_container
from collector_server.settings import API_PREFIX, Settings
from lib.lifespan import LifespanHook
from lib.logging import configure_logging, get_logger
from lib.web import ReadinessProbe, Runtime, create_app

_logger = get_logger("collect.app")

# 关停顺序：停收新命令 → 心跳/租约与会话 → sink 与归档缓冲各冲尾帧 →
# 归档 writer 把流排干 → 连接池。
# ⚠ **不是启动的逆序**：两个缓冲必须比会话晚停（它们要接住拆会话时补交的
# 尾帧），writer 又比缓冲晚停（它要把那一帧排进库），而连接池最后关（前面
# 几件收尾时还要用它）。见 runtime-resilience §8。
SHUTDOWN_COMMAND_BUS = 10
SHUTDOWN_SUPERVISOR = 20
SHUTDOWN_SINK = 30
SHUTDOWN_ARCHIVE_BUFFER = 40
SHUTDOWN_ARCHIVE_WRITER = 50
SHUTDOWN_DATABASE = 90
SHUTDOWN_REDIS = 95

STARTUP_SELFCHECK = 10
# writer 先起：上一次崩溃残留在流里的行要先排出去，不必等这一轮采到新值
STARTUP_ARCHIVE_WRITER = 15
STARTUP_SINK = 20
STARTUP_ARCHIVE_BUFFER = 25
STARTUP_SUPERVISOR = 30
STARTUP_COMMAND_BUS = 40


def build_app(settings: Settings) -> FastAPI:
    """按配置造出应用。测试可传入自造的 Settings。

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
    app = create_app(
        title="DigitalTwin Collector",
        prefix=API_PREFIX,
        runtime=Runtime(
            lifespan_hooks=hooks_of(container),
            readiness_probes=_probes(container),
            drain_timeout_s=settings.app_drain_timeout_s,
        ),
    )
    app.state.container = container
    return app


def hooks_of(container: Container) -> tuple[LifespanHook, ...]:
    """启停钩子。顺序由常量显式声明，并由契约测试锁死。

    Args: container。
    """
    return (
        LifespanHook(
            name="startup_selfcheck",
            startup=lambda: selfcheck(container),
            startup_order=STARTUP_SELFCHECK,
        ),
        *_buffer_hooks(container),
        LifespanHook(
            name="supervisor",
            startup=container.supervisor.start,
            startup_order=STARTUP_SUPERVISOR,
            shutdown=container.supervisor.stop,
            shutdown_order=SHUTDOWN_SUPERVISOR,
        ),
        LifespanHook(
            name="command_bus",
            startup=container.consumer.start,
            startup_order=STARTUP_COMMAND_BUS,
            # 最先停：停收新活排在 drain 之前（runtime-resilience §8）
            shutdown=container.consumer.stop,
            shutdown_order=SHUTDOWN_COMMAND_BUS,
        ),
        LifespanHook(
            name="database",
            shutdown=container.database.dispose,
            shutdown_order=SHUTDOWN_DATABASE,
        ),
        LifespanHook(
            name="redis",
            shutdown=lambda: _close_redis(container),
            shutdown_order=SHUTDOWN_REDIS,
        ),
    )


def _buffer_hooks(container: Container) -> tuple[LifespanHook, ...]:
    """三个缓冲组件的启停。

    ⚠ 它们都比会话早起、比会话晚停：早起是因为会话一连上就会有值进缓冲，
    晚停是因为要接住拆会话时补交的尾帧。

    Args: container。
    """
    return (
        LifespanHook(
            name="snapshot_sink",
            startup=container.sink.start,
            startup_order=STARTUP_SINK,
            shutdown=container.sink.stop,
            shutdown_order=SHUTDOWN_SINK,
        ),
        LifespanHook(
            name="archive_buffer",
            startup=container.archive.start,
            startup_order=STARTUP_ARCHIVE_BUFFER,
            shutdown=container.archive.stop,
            shutdown_order=SHUTDOWN_ARCHIVE_BUFFER,
        ),
        LifespanHook(
            name="archive_writer",
            # 先起：上一次崩溃残留在流里的行不必等这一轮采到新值才排出去
            startup=container.writer.start,
            startup_order=STARTUP_ARCHIVE_WRITER,
            # 最后停：它要把两个缓冲补交的尾帧排进库（runtime-resilience §8）
            shutdown=container.writer.stop,
            shutdown_order=SHUTDOWN_ARCHIVE_WRITER,
        ),
    )


def _probes(container: Container) -> tuple[ReadinessProbe, ...]:
    """就绪探针。

    ⚠ 只看依赖，**与是不是 leader 无关**（observability §5）：热备副本没有
    任何会话，但它随时准备接管，把它判成未就绪会让编排器一直重启它。
    """
    return (
        ReadinessProbe(name="postgres", check=container.database.ping),
        ReadinessProbe(name="redis", check=container.redis.lease.ping),
    )


async def _close_redis(container: Container) -> None:
    """关掉四条 Redis 连接。漏关一条就是泄一个连接池。

    Args: container。
    """
    await container.redis.lease.close()
    await container.redis.snapshot.close()
    await container.redis.stream.close()
    await container.redis.transport.close()


async def selfcheck(container: Container) -> None:
    """启动自检：依赖可达性 + 首份计划 + 工控网可达性。

    ⚠ 连不通要**响亮**：静默退化成一个连不上现场的采集器，是这条链路上最难
    察觉的故障（ARCHITECTURE §7）。这里不结束进程——采集本来就靠退避重连，
    崩溃重启只会把原因埋进重启循环里。

    Args: container.
    """
    is_database_reachable = await container.database.ping()
    is_redis_reachable = await container.redis.lease.ping()
    await container.plan.refresh()
    _logger.info(
        "startup_selfcheck",
        "依赖自检",
        postgres=container.settings.postgres_target(),
        redis=container.settings.redis_target(),
        is_postgres_reachable=is_database_reachable,
        is_redis_reachable=is_redis_reachable,
        has_plan=container.plan.current is not None,
    )
    await _probe_plant(container)


async def _probe_plant(container: Container) -> None:
    """按首份计划探一遍工控网。

    Args: container。
    """
    plan = container.plan.current
    if plan is None:
        _logger.error(
            "plan_missing", "启动时拿不到采集计划，采集将空转直到拿到为止"
        )
        return
    unreachable = await unreachable_codes(plan.sources)
    if unreachable:
        _logger.error(
            "plant_unreachable",
            "有数据源在工控网上连不通，检查网卡与路由",
            source_codes=sorted(unreachable),
            unreachable_count=len(unreachable),
            source_count=len(plan.sources),
        )
