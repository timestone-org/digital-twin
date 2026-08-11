"""装配本服务的 FastAPI 实例。

中间件、异常映射、探针由 `lib.web.create_app` 统一给。
"""

from fastapi import FastAPI

from auth_server.apps.auth.api import ROUTERS
from auth_server.container import Container, build_container
from auth_server.settings import API_PREFIX, Settings
from lib.lifespan import LifespanHook
from lib.logging import configure_logging, get_logger
from lib.web import ReadinessProbe, Runtime, create_app

_logger = get_logger("auth.app")


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
        title="DigitalTwin Auth Server",
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
            name="cache",
            shutdown=container.cache.close,
            # 连接池最后关：在途请求还要用它
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
    """启动自检：把依赖可达性写进日志，不可达不阻断启动但会响亮记录。

    Args: container。
    """
    settings = container.settings
    database_ok = await container.database.ping()
    cache_ok = await container.cache.ping()
    if database_ok and cache_ok:
        _logger.info(
            "startup_selfcheck_passed",
            "依赖自检通过",
            postgres=settings.postgres_target(),
        )
        return
    _logger.error(
        "startup_selfcheck_failed",
        "依赖不可达，服务将保持未就绪",
        postgres_ok=database_ok,
        redis_ok=cache_ok,
    )
