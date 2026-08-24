"""装配本服务的 FastAPI 实例。

中间件、异常映射、探针由 `lib.web.create_app` 统一给。
"""

from fastapi import FastAPI

from ai_assistant.apps.chat.api import ROUTERS
from ai_assistant.container import Container, build_container
from ai_assistant.settings import API_PREFIX, Settings
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
        title="DigitalTwin AI Assistant",
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

    ⚠ 关停顺序不是启动的逆序：外部存储最后关，在途的回合还要用它们把
    「这一步失败了」写回步骤表——写不进去的话，界面上那一步会永远转圈。

    Args: container。
    """
    return (
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
    """就绪探针。

    ⚠ 模型端点**不进探针**：它是外部依赖，抖一下就让整组副本被摘掉，
    而助手在模型不可达时仍要能列历史会话。模型可不可用由
    `/capabilities` 如实回答，不由就绪状态代表。

    Args: container。
    """
    return (
        ReadinessProbe(name="postgres", check=container.database.ping),
        ReadinessProbe(name="redis", check=container.cache.ping),
    )
