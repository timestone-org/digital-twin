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
        _channel_hooks(container)
        + _client_hooks(container)
        + _store_hooks(container)
    )


def _channel_hooks(container: Container) -> tuple[LifespanHook, ...]:
    """通道自己那几件：清残留、扇出、匿名复核、连接。

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
            name="public_sweeper",
            startup=container.sweeper.start,
            # 复核在扇出之后起，先后无所谓：它只读库与内存索引
            startup_order=30,
            # ⚠ 停在连接之前：连接都摘光之后再复核只是空转一轮
            shutdown=container.sweeper.stop,
            shutdown_order=6,
        ),
        LifespanHook(
            name="connections",
            shutdown=container.connections.close_all,
            shutdown_order=10,
        ),
    )


def _client_hooks(container: Container) -> tuple[LifespanHook, ...]:
    """两份打 auth-server 的 HTTP 客户端。

    ⚠ 它们各持一个连接池、一个进程一份且长活，不关就是退出时留下两组还开着
    的 socket。停在连接摘完之后：还在握手的那几条要用它取权限码。

    Args: container。
    """
    return (
        LifespanHook(
            name="user_codes",
            shutdown=container.user_codes.close,
            shutdown_order=20,
        ),
        LifespanHook(
            name="code_catalog",
            shutdown=container.code_catalog.close,
            shutdown_order=20,
        ),
    )


def _store_hooks(container: Container) -> tuple[LifespanHook, ...]:
    """外部存储：在途请求还要用它们，所以最后关。

    Args: container。
    """
    return (
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
    dropped = await container.journal.drop_replica()
    _logger.info(
        "stale_subscriptions_dropped",
        "清掉了本副本上次残留的订阅",
        replica=container.replica,
        dropped=dropped,
    )
