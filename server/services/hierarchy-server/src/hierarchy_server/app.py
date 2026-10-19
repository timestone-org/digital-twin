"""层级图应用与连接生命周期。"""

from fastapi import FastAPI

from hierarchy_server.apps.projects.api.projects import router
from hierarchy_server.container import Container, build_container
from hierarchy_server.settings import API_PREFIX, Settings
from lib.lifespan import LifespanHook
from lib.logging import configure_logging
from lib.web import ReadinessProbe, Runtime, create_app


async def check_dependencies(container: Container) -> None:
    """启动时校验存储连通性。Args: container。"""
    if not await container.database.ping() or not await container.cache.ping():
        raise RuntimeError("层级图存储未就绪")


def build_app(settings: Settings) -> FastAPI:
    """以共享工厂装配服务。Args: settings。"""
    configure_logging(
        service=settings.app_name,
        role=settings.app_role,
        instance=settings.app_instance,
        level=settings.app_log_level,
        log_format=settings.app_log_format,
    )
    container = build_container(settings)
    app = create_app(
        title="DigitalTwin Hierarchy",
        prefix=API_PREFIX,
        routers=(router,),
        runtime=Runtime(
            lifespan_hooks=(
                LifespanHook(
                    name="storage",
                    startup=lambda: check_dependencies(container),
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
            ),
            readiness_probes=(
                ReadinessProbe(name="postgres", check=container.database.ping),
                ReadinessProbe(name="redis", check=container.cache.ping),
            ),
            drain_timeout_s=settings.app_drain_timeout_s,
        ),
    )
    app.state.container = container
    return app
