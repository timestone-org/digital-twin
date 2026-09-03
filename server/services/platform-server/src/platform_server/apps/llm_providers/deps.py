"""模型供应商面自己的依赖注入件。

组合根、事务与闸 2 是服务级公共件，在 `platform_server.deps` 里，本模块只把
它们转手给路由，另外给出加解密器与写上下文。

⚠ 没配加密密钥时**不造加解密器、也不抛在装配期**：那是「这套部署不接模型
供应商目录」，对外端点如实回 503，内部目录回空——两个消费方于是退回各自
环境变量那一档，整个服务照常起。
"""

import uuid
from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.crypto import SecretCipher
from platform_server.apps.llm_providers import crud
from platform_server.apps.llm_providers.catalog import LLM_MANAGE
from platform_server.apps.llm_providers.enums import provider_kind_of
from platform_server.apps.llm_providers.errors import (
    LlmProviderNotFound,
    LlmProviderNotLoginBased,
    LlmProvidersDisabled,
)
from platform_server.apps.llm_providers.services import (
    CredentialStore,
    DeviceLogin,
)
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
    "CredentialsDep",
    "LoginDep",
    "LoginProviderDep",
    "ManageDep",
    "ProbeTimeoutDep",
    "get_caller",
    "get_cipher",
    "get_container",
    "get_credentials",
    "get_device_login",
    "get_login_provider",
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
    if container.llm.cipher is None:
        raise LlmProvidersDisabled(
            "本部署没开模型供应商目录：请先配 PLATFORM_LLM_PROVIDER_SECRET"
        )
    return container.llm.cipher


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


def get_credentials(
    container: Annotated[Container, Depends(get_container)],
) -> CredentialStore:
    """取登录态的读写面；这套部署没开目录就 503。

    Args: container。
    """
    if container.llm.credentials is None:
        raise LlmProvidersDisabled(
            "本部署没开模型供应商目录：请先配 PLATFORM_LLM_PROVIDER_SECRET"
        )
    return container.llm.credentials


def get_device_login(
    container: Annotated[Container, Depends(get_container)],
) -> DeviceLogin:
    """取设备码登录面；这套部署没开目录就 503。

    Args: container。
    """
    if container.llm.device_login is None:
        raise LlmProvidersDisabled(
            "本部署没开模型供应商目录：请先配 PLATFORM_LLM_PROVIDER_SECRET"
        )
    return container.llm.device_login


async def get_login_provider(
    provider_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> uuid.UUID:
    """认一认这一路：不存在就 404，不是靠登录的那一形态就 400。

    ⚠ 形态要问过：给一路填端点的供应商存一行登录态，那一行永远没有人读，
    而界面上表现为「登录成功了、消费方却说没登录」。

    Args: provider_id, session。
    """
    row = await crud.provider.get(session, provider_id)
    if row is None:
        raise LlmProviderNotFound("没有这一路供应商")
    spec = provider_kind_of(row.kind)
    if spec is None or not spec.is_login_required:
        raise LlmProviderNotLoginBased("这一路不走登录，它填的是端点与密钥")
    return provider_id


CredentialsDep = Annotated[CredentialStore, Depends(get_credentials)]
LoginDep = Annotated[DeviceLogin, Depends(get_device_login)]
LoginProviderDep = Annotated[uuid.UUID, Depends(get_login_provider)]
