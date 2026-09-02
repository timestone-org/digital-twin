"""装配本服务的 FastAPI 实例。

中间件、异常映射、探针由 `lib.web.create_app` 统一给。
"""

from collections.abc import Awaitable, Callable

from fastapi import FastAPI

from knowledge_server.apps.chat.api import CHAT_ROUTERS
from knowledge_server.apps.knowledge.api import ROUTERS
from knowledge_server.apps.speech.api import SPEECH_ROUTERS
from knowledge_server.container import Container, build_container
from knowledge_server.probe import probe_indexes
from knowledge_server.settings import API_PREFIX, Settings
from lib.lifespan import LifespanHook
from lib.logging import configure_logging
from lib.web import ReadinessProbe, Runtime, create_app


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
        title="DigitalTwin Knowledge",
        prefix=API_PREFIX,
        routers=(*ROUTERS, *CHAT_ROUTERS, *SPEECH_ROUTERS),
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

    ⚠ 关停顺序不是启动的逆序：外部存储最后关，在途的摄取还要用它们把
    「这一步失败了」写回文档行——写不进去的话，界面上那份文档会永远转圈。

    Args: container。
    """

    async def probe() -> None:
        await probe_indexes(container.database, container.index)

    return (
        LifespanHook(name="index-probe", startup=probe, startup_order=20),
        # ⚠ 目录先拉一次再接流量：不拉的话第一批检索与摄取读到的是空目录，
        # 全部退回环境变量那一档——而那一档可能根本没配。拉不到不阻塞启动：
        # 目录缓存自己吞掉失败、沿用空的那一份，随后每次调用按 TTL 再试
        LifespanHook(
            name="llm-catalog",
            startup=_prefetch_catalog(container),
            startup_order=25,
        ),
        LifespanHook(
            name="platform",
            # ⚠ 停在存储之前：在途的同步还可能正等它答复，而那之后才轮到
            # 把结果写回来源行
            shutdown=container.platform.aclose,
            shutdown_order=50,
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


def _prefetch_catalog(container: Container) -> Callable[[], Awaitable[None]]:
    """把「启动时拉一次目录」包成启动动作。拉不到也不抛。

    Args: container。
    """

    async def prefetch() -> None:
        await container.catalog.refresh(is_forced=True)

    return prefetch


def _probes(container: Container) -> tuple[ReadinessProbe, ...]:
    """就绪探针。

    ⚠ 嵌入端点与对话端点**不进探针**：它们是外部依赖，抖一下就让整组副本被
    摘掉，而知识库在模型不可达时仍要能列文档、看块。接没接由 `/capabilities`
    如实回答，不由就绪状态代表。

    ⚠ 对象存储也不进：上传那一路用它，而读侧完全不需要——它挂了不该让检索
    跟着不可用。

    Args: container。
    """
    return (
        ReadinessProbe(name="postgres", check=container.database.ping),
        ReadinessProbe(name="redis", check=container.cache.ping),
    )
