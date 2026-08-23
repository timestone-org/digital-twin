"""装配本服务的 FastAPI 实例。

中间件、异常映射、探针由 `lib.web.create_app` 统一给。
"""

from fastapi import FastAPI

from lib.lifespan import LifespanHook
from lib.logging import configure_logging, get_logger
from lib.web import ReadinessProbe, Runtime, create_app
from platform_server.apps.assets.api import ROUTERS as ASSET_ROUTERS
from platform_server.apps.collect.api import ROUTERS as COLLECT_ROUTERS
from platform_server.apps.dashboard.api import ROUTERS as DASHBOARD_ROUTERS
from platform_server.apps.dataset.api import ROUTERS as DATASET_ROUTERS
from platform_server.apps.hvac.api import ROUTERS as HVAC_ROUTERS
from platform_server.apps.runtime_params.api import (
    ROUTERS as RUNTIME_PARAM_ROUTERS,
)
from platform_server.container import Container, build_container
from platform_server.settings import API_PREFIX, Settings

_logger = get_logger("platform.app")


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
        title="DigitalTwin Platform Server",
        prefix=API_PREFIX,
        routers=(
            *HVAC_ROUTERS,
            *DASHBOARD_ROUTERS,
            *COLLECT_ROUTERS,
            *DATASET_ROUTERS,
            *RUNTIME_PARAM_ROUTERS,
            *ASSET_ROUTERS,
        ),
        runtime=Runtime(
            lifespan_hooks=_hooks(container),
            readiness_probes=_probes(container),
            drain_timeout_s=settings.app_drain_timeout_s,
        ),
    )
    app.state.container = container
    return app


def _hooks(container: Container) -> tuple[LifespanHook, ...]:
    return (
        LifespanHook(
            name="startup_selfcheck",
            startup=lambda: _selfcheck(container),
            startup_order=10,
        ),
        _backfill_hook(container),
        *_client_hooks(container),
        *_http_hooks(container),
        *_pool_hooks(container),
    )


def _backfill_hook(container: Container) -> LifespanHook:
    """在跑的历史回填先收摊，再关 Redis 与连接池。

    ⚠ 顺序不是启动的逆序：这一步必须排在 Redis 与连接池**之前**——回填收摊
    时还要写一次终态、放一次锁，两样都要 Redis，而最后一批的提交要连接池。
    ⚠ 收摊是协作式的：置位之后在跑的任务补完手上那一批就停，绝不留半个批次。
    Args: container。
    """
    runner = container.dataset.backfill

    async def shutdown() -> None:
        runner.stop()
        await runner.drain(container.settings.app_drain_timeout_s)

    return LifespanHook(
        name="dataset_backfill", shutdown=shutdown, shutdown_order=96
    )


def _client_hooks(container: Container) -> tuple[LifespanHook, ...]:
    """先关的一批：Redis 上那几条客户端连接。

    Args: container。
    """
    return (
        LifespanHook(
            name="stream",
            shutdown=container.stream.close,
            shutdown_order=97,
        ),
        LifespanHook(
            name="cache",
            shutdown=container.cache.close,
            shutdown_order=97,
        ),
        LifespanHook(
            name="command_bus",
            shutdown=container.command_transport.close,
            shutdown_order=97,
        ),
        LifespanHook(
            name="pubsub",
            shutdown=container.pubsub.close,
            shutdown_order=97,
        ),
        # ⚠ 快照与租约是 publisher 角色才用的，但组合根对每个角色装的是同一
        # 份容器——装了就要关，否则 api 角色退出时会漏掉两个 Redis 连接池
        LifespanHook(
            name="snapshots",
            shutdown=container.snapshots.close,
            shutdown_order=97,
        ),
        LifespanHook(
            name="lease",
            shutdown=container.lease.close,
            shutdown_order=97,
        ),
    )


def _http_hooks(container: Container) -> tuple[LifespanHook, ...]:
    """与 Redis 那批同批关的：两份内部 HTTP 客户端。

    ⚠ 它们各持一个连接池、一个进程一份且长活，不关就是退出时留下两组还开着
    的 socket。

    Args: container。
    """
    return (
        LifespanHook(
            name="realtime",
            shutdown=container.realtime.close,
            shutdown_order=97,
        ),
        LifespanHook(
            name="opcua",
            shutdown=container.nodes.close,
            shutdown_order=97,
        ),
    )


def _pool_hooks(container: Container) -> tuple[LifespanHook, ...]:
    """后关的一批：外库与连接池。连接池最后关，在途请求还要用它。

    Args: container。
    """
    return (
        LifespanHook(
            name="ac_source",
            shutdown=container.ac_source.dispose,
            shutdown_order=98,
        ),
        LifespanHook(
            name="history_database",
            shutdown=container.history_database.dispose,
            shutdown_order=99,
        ),
        LifespanHook(
            name="viewer_database",
            shutdown=container.viewer_database.dispose,
            shutdown_order=99,
        ),
        LifespanHook(
            name="database",
            shutdown=container.database.dispose,
            # 连接池最后关：在途请求还要用它
            shutdown_order=99,
        ),
    )


def _probes(container: Container) -> tuple[ReadinessProbe, ...]:
    # ⚠ 外部只读源不进就绪判定（docs/adr/0006）：它抖一下只该让空调数据面返回
    # 503，台账页与空间配置页照常工作；进了这里就是整个副本被摘流量
    return (ReadinessProbe(name="postgres", check=container.database.ping),)


async def _selfcheck(container: Container) -> None:
    """启动自检：把依赖可达性写进日志，不可达不阻断启动但会响亮记录。

    Args: container。
    """
    settings = container.settings
    if await container.database.ping():
        _logger.info(
            "startup_selfcheck_passed",
            "依赖自检通过",
            postgres=settings.postgres_target(),
        )
    else:
        _logger.error(
            "startup_selfcheck_failed",
            "数据库不可达，服务将保持未就绪",
            postgres=settings.postgres_target(),
        )
    await _selfcheck_ac_source(container)


async def _selfcheck_ac_source(container: Container) -> None:
    """外部只读源的可达性只记录、不阻断启动，也不进就绪判定。

    Args: container。
    """
    target = container.settings.sqlserver_target()
    if await container.ac_source.ping():
        _logger.info(
            "ac_source_selfcheck_passed", "外部只读数据源可达", ac_source=target
        )
        return
    _logger.warning(
        "ac_source_selfcheck_failed",
        "外部只读数据源不可达，空调数据面将返回 503",
        ac_source=target,
    )
