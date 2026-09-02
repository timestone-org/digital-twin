"""凭据面：看登录态、走一次设备码登录、退出登录。四条端点一律要
`assistant:manage`。

⚠ 这一份凭据是**整套部署共用的**：换掉它等于替所有人换了说话的账号。
所以它比会话那几条更严——那几条只要 `assistant:use`。

⚠ 路径上那个键是**那一路供应商的 id**（环境变量配出来的那一路是 `codex`）：
认不认得出由 `deps.get_provider` 问注册表，端点自己不判。

⚠ 轮询由浏览器驱动：服务端每次只问上游一次，不起后台任务。api 角色无状态，
下一次轮询可能落到另一个副本上。
"""

from fastapi import APIRouter, Response, status

from ai_assistant.apps.credential.deps import (
    IdempotencyKeyDep,
    LoginDep,
    ManageDep,
    ProviderDep,
    StoreDep,
)
from ai_assistant.apps.credential.errors import CredentialNotFound
from ai_assistant.apps.credential.schemas import (
    CredentialStatusOut,
    DeviceLoginPollIn,
    DeviceLoginPollOut,
    DeviceLoginStartOut,
)
from ai_assistant.apps.credential.services import CredentialStatus
from ai_assistant.settings import API_PREFIX
from lib.web import ApiResponse, ok

router = APIRouter(
    prefix=f"{API_PREFIX}/credentials", tags=["model-credential"]
)


@router.get(
    "/{provider}",
    response_model=ApiResponse[CredentialStatusOut],
    summary="模型账号登录态",
)
async def read_status(
    provider: ProviderDep, store: StoreDep, _caller: ManageDep
) -> ApiResponse[CredentialStatusOut]:
    """挂着的是哪个账号、什么时候过期。

    Args: provider, store, _caller。
    """
    return ok(_out(await store.status(provider)))


@router.post(
    "/{provider}:start-login",
    response_model=ApiResponse[DeviceLoginStartOut],
    summary="开始设备码登录",
)
async def start_login(
    provider: ProviderDep,
    login: LoginDep,
    _caller: ManageDep,
    _key: IdempotencyKeyDep = None,
) -> ApiResponse[DeviceLoginStartOut]:
    """要一个用户码与验证地址，交给人去别的设备上确认。

    Args: provider, login, _caller, _key。
    """
    started = await login.start(provider)
    return ok(
        DeviceLoginStartOut(
            ref=started.ref,
            user_code=started.user_code,
            verification_uri=started.verification_uri,
            interval_s=started.interval_s,
            expires_in_s=started.expires_in_s,
        )
    )


@router.post(
    "/{provider}:poll-login",
    response_model=ApiResponse[DeviceLoginPollOut],
    summary="问一次登录好了没",
)
async def poll_login(
    provider: ProviderDep,
    store: StoreDep,
    login: LoginDep,
    caller: ManageDep,
    body: DeviceLoginPollIn,
) -> ApiResponse[DeviceLoginPollOut]:
    """问一次；点完了就把令牌存下来并把最新状态一并带回。

    Args: provider, store, login, caller, body。
    """
    progress = await login.poll(body.ref, actor_id=caller.user_id)
    done = progress.is_done
    return ok(
        DeviceLoginPollOut(
            is_done=done,
            interval_s=progress.interval_s,
            status=_out(await store.status(provider)) if done else None,
        )
    )


@router.delete(
    "/{provider}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="退出模型账号",
)
async def forget(
    provider: ProviderDep, store: StoreDep, _caller: ManageDep
) -> Response:
    """把这一路的凭据整行删掉。

    Args: provider, store, _caller。
    """
    if not await store.forget(provider):
        raise CredentialNotFound("这一路模型本来就没登录")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _out(given: CredentialStatus) -> CredentialStatusOut:
    """服务层的状态摊成出参。⚠ 令牌不在里面，也永远不该在。

    Args: given。
    """
    return CredentialStatusOut(
        provider=given.provider,
        is_connected=given.is_connected,
        account_label=given.account_label,
        plan_label=given.plan_label,
        expires_at=given.expires_at,
        last_refresh_at=given.last_refresh_at,
        last_error=given.last_error,
    )
