"""装配本服务的 FastAPI 实例。

中间件、异常映射、探针由 `lib.web.create_app` 统一给。
"""

from fastapi import FastAPI

from lib.lifespan import LifespanHook
from lib.logging import configure_logging, get_logger
from lib.web import ReadinessProbe, Runtime, create_app
from platform_server.apps.hvac.api import ROUTERS
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
    return (
        LifespanHook(
            name="startup_selfcheck",
            startup=lambda: _selfcheck(container),
            startup_order=10,
        ),
        LifespanHook(
            name="stream",
            shutdown=container.stream.close,
            shutdown_order=97,
        ),
        LifespanHook(
            name="ac_source",
            shutdown=container.ac_source.dispose,
            shutdown_order=98,
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
