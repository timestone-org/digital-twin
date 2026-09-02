"""模型供应商面自己的依赖注入件。

组合根、事务与闸 2 是服务级公共件，在 `platform_server.deps` 里，本模块只把
它们转手给路由，另外给出加解密器与写上下文。

⚠ 没配加密密钥时**不造加解密器、也不抛在装配期**：那是「这套部署不接模型
供应商目录」，对外端点如实回 503，内部目录回空——两个消费方于是退回各自
环境变量那一档，整个服务照常起。
"""

from typing import Annotated

from fastapi import Depends

from lib.auth import CallerContext
from lib.crypto import SecretCipher
from platform_server.apps.llm_providers.catalog import LLM_MANAGE
from platform_server.apps.llm_providers.errors import LlmProvidersDisabled
from platform_server.container import Container
from platform_server.deps import (
    WriteGate,
    get_caller,
    get_container,
    get_idempotency_key,
    get_session,
    require,
    require_service_key,
)

__all__ = [
    "CipherDep",
    "ManageDep",
    "ProbeTimeoutDep",
    "get_caller",
    "get_cipher",
    "get_container",
    "get_manage_gate",
    "get_session",
    "require",
    "require_service_key",
]


def get_cipher(
    container: Annotated[Container, Depends(get_container)],
) -> SecretCipher:
    """取密钥加解密器；这套部署没开目录就 503。

    Args: container。
    """
    if container.llm_cipher is None:
        raise LlmProvidersDisabled(
            "本部署没开模型供应商目录：请先配 PLATFORM_LLM_PROVIDER_SECRET"
        )
    return container.llm_cipher


def get_probe_timeout(
    container: Annotated[Container, Depends(get_container)],
) -> float:
    """探测端点的预算。

    Args: container。
    """
    return container.settings.llm_probe_timeout_s


def get_manage_gate(
    container: Annotated[Container, Depends(get_container)],
    caller: Annotated[CallerContext, Depends(require(LLM_MANAGE))],
    idempotency_key: Annotated[str | None, Depends(get_idempotency_key)],
) -> WriteGate:
    """写上下文：要 `llm:manage`，带幂等键。

    Args: container, caller, idempotency_key。
    """
    return WriteGate(
        idempotency=container.idempotency,
        idempotency_key=idempotency_key,
        caller=caller,
    )


CipherDep = Annotated[SecretCipher, Depends(get_cipher)]
ManageDep = Annotated[WriteGate, Depends(get_manage_gate)]
ProbeTimeoutDep = Annotated[float, Depends(get_probe_timeout)]
