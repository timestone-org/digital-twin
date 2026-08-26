"""本功能模块的依赖：取凭据服务、取写上下文。

⚠ 没开 codex 时**不造服务、也不抛在装配期**：那是「这套部署不接订阅账号」，
端点如实回 503，而不是让整个服务起不来（与容器里模型那一路同口径）。
"""

from typing import Annotated

from fastapi import Depends

from ai_assistant.apps.credential.catalog import ASSISTANT_MANAGE
from ai_assistant.apps.credential.errors import ProviderDisabled
from ai_assistant.apps.credential.services import CredentialStore, DeviceLogin
from ai_assistant.container import Container
from ai_assistant.deps import get_container, get_idempotency_key, require
from lib.auth import CallerContext


def get_store(
    container: Annotated[Container, Depends(get_container)],
) -> CredentialStore:
    """取凭据读写面；这套部署没接订阅账号就 503。

    Args: container。
    """
    if container.credentials is None:
        raise ProviderDisabled("本部署没有接订阅账号那一路模型")
    return container.credentials


def get_device_login(
    container: Annotated[Container, Depends(get_container)],
) -> DeviceLogin:
    """取设备码登录面；这套部署没接订阅账号就 503。

    Args: container。
    """
    if container.device_login is None:
        raise ProviderDisabled("本部署没有接订阅账号那一路模型")
    return container.device_login


StoreDep = Annotated[CredentialStore, Depends(get_store)]
LoginDep = Annotated[DeviceLogin, Depends(get_device_login)]
ManageDep = Annotated[CallerContext, Depends(require(ASSISTANT_MANAGE))]
IdempotencyKeyDep = Annotated[str | None, Depends(get_idempotency_key)]
