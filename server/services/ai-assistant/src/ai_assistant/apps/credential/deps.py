"""本功能模块的依赖：取凭据服务、取写上下文、认这一路登录得了没。

⚠ 没开 codex 时**不造服务、也不抛在装配期**：那是「这套部署不接订阅账号」，
端点如实回 503，而不是让整个服务起不来（与容器里模型那一路同口径）。

⚠ 路径上那个键**不是闭合集合**：目录里能配出好几路要登录的供应商，键就是那一路
的 id。认不认得出去问注册表——写死一份取值的话，新配的那一路永远登录不了；
一个字符串都不拦的话，登录会存出一行永远没有人读的凭据，而界面上表现为
「登录成功了但助手说没登录」。
"""

from typing import Annotated

from fastapi import Depends

from ai_assistant.apps.credential.catalog import ASSISTANT_MANAGE
from ai_assistant.apps.credential.errors import (
    ProviderDisabled,
    ProviderUnknown,
)
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


async def get_provider(
    provider: str,
    container: Annotated[Container, Depends(get_container)],
) -> str:
    """认一认这个键：目录里没有这一路要登录的供应商就 404。

    ⚠ **先看这套部署接没接订阅账号那一路**：没接时回 503（这套环境就没接），
    接了但没有这个键才是 404（去配一路）。反过来的话，一套根本没配加密密钥的
    部署会报「没有这一路供应商」，而人会照着那句话去建一路，然后卡在登录上。

    ⚠ 再让目录刷新一次：刚在界面上配出来的那一路，不刷新就要等一个 TTL
    才登录得了，而那期间报出来的是「没有这一路」。

    Args: provider, container。
    """
    if container.credentials is None:
        raise ProviderDisabled("本部署没有接订阅账号那一路模型")
    await container.models.refresh()
    if provider not in container.models.login_refs():
        raise ProviderUnknown("没有这一路要登录的供应商，先去模型管理页配一路")
    return provider


StoreDep = Annotated[CredentialStore, Depends(get_store)]
ProviderDep = Annotated[str, Depends(get_provider)]
LoginDep = Annotated[DeviceLogin, Depends(get_device_login)]
ManageDep = Annotated[CallerContext, Depends(require(ASSISTANT_MANAGE))]
IdempotencyKeyDep = Annotated[str | None, Depends(get_idempotency_key)]
