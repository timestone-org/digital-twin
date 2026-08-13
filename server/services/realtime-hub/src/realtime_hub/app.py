"""装配本服务的 FastAPI 实例。

中间件、异常映射、探针由 `lib.web.create_app` 统一给。
"""

from fastapi import FastAPI

from lib.lifespan import LifespanHook
from lib.logging import configure_logging, get_logger
from lib.web import ReadinessProbe, Runtime, create_app
from realtime_hub.apps.channel.api import ROUTERS
from realtime_hub.container import Container, build_container
from realtime_hub.settings import API_PREFIX, Settings

_logger = get_logger("realtime.app")


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
        title="DigitalTwin Realtime Hub",
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

    ⚠ 关停顺序不是启动的逆序：**连接最先摘**（10），它们持有客户端的
    socket，晚摘会让对端在我们已经关掉数据库之后还在发订阅；缓存与数据库
    最后关，在途请求还要用它们。

    Args: container。
    """
    return (
        LifespanHook(
            name="drop_stale_subscriptions",
            startup=lambda: _drop_stale(container),
            startup_order=10,
        ),
        LifespanHook(
            name="fanout",
            startup=container.fanout.start,
            # 扇出在清残留之后起：先把上次的脏行清掉，再开始收消息
            startup_order=20,
            # ⚠ 停在连接之前：还在收消息却已经没有连接可发，只会刷一堆
            # 「没人订」的日志
            shutdown=container.fanout.stop,
            shutdown_order=5,
        ),
        LifespanHook(
            name="connections",
            shutdown=container.connections.close_all,
            shutdown_order=10,
        ),
        LifespanHook(
            name="pubsub",
            shutdown=container.pubsub.close,
            shutdown_order=80,
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


async def _drop_stale(container: Container) -> None:
    """清掉本副本上次留下的订阅行。

    ⚠ 副本被强杀时来不及清自己的行，重启后它们会一直挂着，让对账看到
    「有人在订」而实际上一条连接都没有。按副本名清，只动自己那些。

    Args: container。
    """
    async with container.database.session() as session:
        dropped = await container.subscriptions.drop_replica(
            session, container.replica
        )
    _logger.info(
        "stale_subscriptions_dropped",
        "清掉了本副本上次残留的订阅",
        replica=container.replica,
        dropped=dropped,
    )
