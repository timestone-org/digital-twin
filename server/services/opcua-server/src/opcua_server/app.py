"""装配本服务的 FastAPI 实例。

中间件、异常映射、探针由 `lib.web.create_app` 统一给。
"""

from fastapi import FastAPI

from lib.lifespan import LifespanHook
from lib.logging import configure_logging, get_logger
from lib.web import ReadinessProbe, Runtime, create_app
from opcua_server.apps.instance.api import ROUTERS
from opcua_server.container import Container, build_container
from opcua_server.settings import API_PREFIX, Settings

_logger = get_logger("opcua.app")


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
        title="DigitalTwin OPC UA Server",
        prefix=API_PREFIX,
        routers=ROUTERS,
        runtime=Runtime(
            lifespan_hooks=_hooks(container),
            readiness_probes=_probes(container),
            drain_timeout_s=settings.app_drain_timeout_s,
        ),
    )
    app.state.container = container
    return app


def _hooks(container: Container) -> tuple[LifespanHook, ...]:
    """启停钩子。

    ⚠ 关停顺序不是启动的逆序：**实例最先停**（10），因为它们持有上位机的
    TCP 连接，晚停会让对端在我们已经关掉数据库之后还在读写；缓存与数据库
    最后关，在途请求还要用它们。

    Args: container。
    """
    return (
        LifespanHook(
            name="startup_selfcheck",
            startup=lambda: _selfcheck(container),
            startup_order=10,
        ),
        LifespanHook(
            name="autostart_instances",
            startup=container.instances.autostart,
            # 自启排在自检之后：依赖不通时先把这件事写进日志再谈起实例
            startup_order=20,
        ),
        LifespanHook(
            name="opcua_instances",
            shutdown=container.supervisor.stop_all,
            shutdown_order=10,
        ),
        LifespanHook(
            name="cache",
            shutdown=container.cache.close,
            shutdown_order=90,
        ),
        LifespanHook(
            name="database",
            shutdown=container.database.dispose,
            shutdown_order=99,
        ),
    )


def _probes(container: Container) -> tuple[ReadinessProbe, ...]:
    return (
        ReadinessProbe(name="postgres", check=container.database.ping),
        ReadinessProbe(name="redis", check=container.cache.ping),
    )


async def _selfcheck(container: Container) -> None:
    """启动自检：把依赖可达性与端口池写进日志。

    ⚠ 端口池小于实例数上限在配置校验期就被判死，这里只记录实际取值，
    方便在现场对照容器的端口段映射——两者不一致时实例会「显示运行中
    但连不上」，而那是最难排查的一类故障。

    Args: container。
    """
    settings = container.settings
    database_ok = await container.database.ping()
    cache_ok = await container.cache.ping()
    pool = settings.ports()
    if database_ok and cache_ok:
        _logger.info(
            "startup_selfcheck_passed",
            "依赖自检通过",
            postgres=settings.postgres_target(),
            port_pool=settings.port_pool,
            port_pool_size=len(pool),
            max_instances=settings.max_instances,
        )
        return
    _logger.error(
        "startup_selfcheck_failed",
        "依赖不可达，服务将保持未就绪",
        postgres_ok=database_ok,
        redis_ok=cache_ok,
    )
