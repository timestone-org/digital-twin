"""采集/归档两组运行参数。读用 `collect:view`，写用 `collect:manage`。

参数目录与读写编排复用 `apps/runtime_params` 的 services 公开面；这条路由单列
是因为写权限码不同——闸 2 的静态声明挂在路由上，一条路由声明不出两个码。
写成功后要**通知计划变更**：这两组的消费者是 collector-server，覆盖值随采集
计划下发，不通知它就要等满一个刷新周期。
"""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, ok
from platform_server.apps.collect.catalog import COLLECT_VIEW
from platform_server.apps.collect.deps import (
    WriteContext,
    get_container,
    get_manage_context,
    get_session,
    require,
)
from platform_server.apps.collect.services import runtime_param_face
from platform_server.apps.runtime_params.services import (
    RuntimeParamOut,
    RuntimeParamWriteIn,
)
from platform_server.container import Container
from platform_server.settings import API_PREFIX, Settings

router = APIRouter(
    prefix=f"{API_PREFIX}/collect-runtime-params", tags=["collect-source"]
)

# 计划变更的原因，稳定字面量（日志与广播共用）
REASON_PARAMS_CHANGED = "runtime_params_changed"


def get_settings(
    container: Annotated[Container, Depends(get_container)],
) -> Settings:
    """取本进程的配置对象（默认值每次现取，不是启动时抄一份）。

    Args: container。
    """
    return container.settings


SessionDep = Annotated[AsyncSession, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
ViewDep = Annotated[CallerContext, Depends(require(COLLECT_VIEW))]
ManageDep = Annotated[WriteContext, Depends(get_manage_context)]


@router.get(
    "",
    response_model=ApiResponse[list[RuntimeParamOut]],
    summary="采集/归档运行参数目录与当前取值",
)
async def list_collect_runtime_params(
    session: SessionDep,
    settings: SettingsDep,
    _viewer: ViewDep,
    section: str | None = None,
) -> ApiResponse[list[RuntimeParamOut]]:
    """列出采集与归档两组运行参数。给了 `section` 就只回那一组。

    Args: session, settings, _viewer, section。
    """
    return ok(
        await runtime_param_face.read_items(
            session, settings=settings, section=section
        )
    )


@router.put(
    "/{section}",
    response_model=ApiResponse[list[RuntimeParamOut]],
    summary="修改一组采集/归档运行参数",
)
async def replace_collect_runtime_params(
    section: str,
    payload: RuntimeParamWriteIn,
    session: SessionDep,
    settings: SettingsDep,
    write: ManageDep,
) -> ApiResponse[list[RuntimeParamOut]]:
    """改一个分组里的若干项，改完通知采集计划变更。

    Args: section, payload, session, settings, write。
    """
    state = await runtime_param_face.write_section(
        session,
        settings=settings,
        section=section,
        payload=payload,
        actor=str(write.caller.user_id),
    )
    await write.plans.notify(reason=REASON_PARAMS_CHANGED)
    return ok(state, message="运行参数已更新")


@router.post(
    "/{section}:reset",
    response_model=ApiResponse[list[RuntimeParamOut]],
    summary="恢复一组采集/归档运行参数的默认值",
)
async def reset_collect_runtime_params(
    section: str,
    session: SessionDep,
    settings: SettingsDep,
    write: ManageDep,
) -> ApiResponse[list[RuntimeParamOut]]:
    """删掉该分组的覆盖行，此后重新跟随采集器的环境变量。

    Args: section, session, settings, write。
    """
    state = await runtime_param_face.reset_section(
        session,
        settings=settings,
        section=section,
        actor=str(write.caller.user_id),
    )
    await write.plans.notify(reason=REASON_PARAMS_CHANGED)
    return ok(state, message="运行参数已恢复默认")
