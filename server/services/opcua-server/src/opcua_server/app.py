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

    ⚠ 关停顺序不是启动的逆序：**实例最先停**，它们持有上位机的 TCP 连接，
    晚停会让对端在我们已经关掉数据库之后还在读写；缓存与数据库最后关。

    Args: container。
    """
    return (*_startup_hooks(container), *_shutdown_hooks(container))


def _startup_hooks(container: Container) -> tuple[LifespanHook, ...]:
    """启动钩子，按 order 升序执行。

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
        # ⚠ 对账排在自启之后：先把实例起起来，再按最终的实例表对一遍
        LifespanHook(
            name="topic_reconcile",
            startup=lambda: _reconcile(container),
            startup_order=30,
        ),
        LifespanHook(
            name="value_publisher",
            startup=container.values.start,
            startup_order=40,
            # ⚠ 停在实例之前：实例一停就不再有值变化，此时把攒着的最后一批
            # 冲刷出去；反过来会把这批值丢掉
            shutdown=container.values.stop,
            shutdown_order=5,
        ),
    )


def _shutdown_hooks(container: Container) -> tuple[LifespanHook, ...]:
    """关停钩子，按 order 升序执行。

    Args: container。
    """
    return (
        LifespanHook(
            name="opcua_instances",
            shutdown=container.supervisor.stop_all,
            shutdown_order=10,
        ),
        # ⚠ 停在实例之后、缓存之前：值发布器冲刷最后一批时还要用它
        LifespanHook(
            name="realtime",
            shutdown=container.realtime.close,
            shutdown_order=20,
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


async def _reconcile(container: Container) -> None:
    """主题对账。

    ⚠ 它绝不能让启动失败：hub 不可达时安静跳过本轮，下次启动再对。
    实时推送是可选链路，不该由它决定服务能不能起。

    Args: container。
    """
    declared, revoked = await container.reconciler.reconcile()
    if declared or revoked:
        _logger.warning(
            "topics_drifted",
            "主题与实例表曾经漂移，已对齐",
            declared=declared,
            revoked=revoked,
        )
