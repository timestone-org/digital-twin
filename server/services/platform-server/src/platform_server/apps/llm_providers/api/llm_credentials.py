"""登录态面：看这一路登没登录、走一次设备码登录、退出登录。

⚠ 挂在供应商那一行之下：登录态是「这一路怎么接」的一部分，与那一行同属主
（ADR-0041）。写那三条要 `llm:manage`——这一份凭据是**整套部署共用的**，
换掉它等于替所有消费方换了说话的账号；读那一条要 `llm:view`，与边缘规则同口径。

⚠ 轮询由浏览器驱动：服务端每次只问上游一次，不起后台任务。api 角色无状态，
下一次轮询可能落到另一个副本上。
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status

from lib.auth import CallerContext
from lib.web import ApiResponse, ok
from platform_server.apps.llm_providers.catalog import LLM_VIEW
from platform_server.apps.llm_providers.deps import (
    CredentialsDep,
    LoginDep,
    LoginProviderDep,
    ManageDep,
    require,
)
from platform_server.apps.llm_providers.errors import LlmCredentialNotFound
from platform_server.apps.llm_providers.schemas import (
    LlmCredentialOut,
    LlmDeviceLoginPollIn,
    LlmDeviceLoginPollOut,
    LlmDeviceLoginStartOut,
)
from platform_server.apps.llm_providers.services import (
    CredentialStore,
    DeviceLogin,
)
from platform_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/llm-providers", tags=["llm-credential"]
)

ViewDep = Annotated[CallerContext, Depends(require(LLM_VIEW))]


@router.get(
    "/{provider_id}/credential",
    response_model=ApiResponse[LlmCredentialOut],
    summary="订阅账号登录态",
)
async def read_credential(
    provider_id: LoginProviderDep,
    credentials: CredentialsDep,
    _viewer: ViewDep,
) -> ApiResponse[LlmCredentialOut]:
    """挂着的是哪个账号、什么时候过期。

    ⚠ 读只要 `llm:view`：与边缘那条「`llm-*` 的 GET 要 view」逐字一致
    （auth-server 的 924 号规则）。收成 manage 的话，只读用户在边缘处放行、
    在端点上 403，而两边代码单看都对。令牌本来就不在这条的出参里。

    Args: provider_id, credentials, _viewer。
    """
    found = await credentials.status(provider_id)
    return ok(LlmCredentialOut.model_validate(found))


@router.post(
    "/{provider_id}/credential:start-login",
    response_model=ApiResponse[LlmDeviceLoginStartOut],
    summary="开始设备码登录",
)
async def start_login(
    provider_id: LoginProviderDep, login: LoginDep, write: ManageDep
) -> ApiResponse[LlmDeviceLoginStartOut]:
    """要一个用户码与验证地址，交给人去别的设备上确认。支持 `Idempotency-Key`。

    Args: provider_id, login, write。
    """
    return ok(
        await write.run_once(
            endpoint="start_llm_device_login",
            model=LlmDeviceLoginStartOut,
            action=lambda: _started(login, provider_id),
        )
    )


@router.post(
    "/{provider_id}/credential:poll-login",
    response_model=ApiResponse[LlmDeviceLoginPollOut],
    summary="问一次登录好了没",
)
async def poll_login(
    provider_id: LoginProviderDep,
    body: LlmDeviceLoginPollIn,
    credentials: CredentialsDep,
    login: LoginDep,
    write: ManageDep,
) -> ApiResponse[LlmDeviceLoginPollOut]:
    """问一次；点完了就把令牌存下来并把最新状态一并带回。

    Args: provider_id, body, credentials, login, write。
    """
    return ok(
        await _polled(
            provider_id, body, credentials, login, str(write.caller.user_id)
        )
    )


@router.delete(
    "/{provider_id}/credential",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="退出订阅账号",
)
async def forget_credential(
    provider_id: LoginProviderDep,
    credentials: CredentialsDep,
    _write: ManageDep,
) -> Response:
    """把这一路的登录态整行删掉。

    Args: provider_id, credentials, _write。
    """
    if not await credentials.forget(provider_id):
        raise LlmCredentialNotFound("这一路订阅账号本来就没登录")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _started(
    login: DeviceLogin, provider_id: uuid.UUID
) -> LlmDeviceLoginStartOut:
    """开一次设备码登录并摊成出参。

    Args: login, provider_id。
    """
    return LlmDeviceLoginStartOut.model_validate(await login.start(provider_id))


async def _polled(
    provider_id: uuid.UUID,
    body: LlmDeviceLoginPollIn,
    credentials: CredentialStore,
    login: DeviceLogin,
    actor: str,
) -> LlmDeviceLoginPollOut:
    """轮询一次并按结果补上登录态。

    ⚠ 登好了才去读一次状态：没登好时那一读读的是「还没登录」，白开一个事务。

    Args: provider_id, body, credentials, login, actor。
    """
    progress = await login.poll(body.ref, actor=actor)
    if not progress.is_done:
        return LlmDeviceLoginPollOut(
            is_done=False, interval_s=progress.interval_s
        )
    found = await credentials.status(provider_id)
    return LlmDeviceLoginPollOut(
        is_done=True,
        interval_s=progress.interval_s,
        credential=LlmCredentialOut.model_validate(found),
    )
