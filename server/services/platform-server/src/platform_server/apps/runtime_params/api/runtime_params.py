"""运行参数面。读用 `dashboard:view`，写用各分组自己的码。

⚠ 眼下全部分组共用 `dashboard:edit`，故写面能用一条静态声明兜住。出现第二个
不同的写码时必须按分组拆路由——闸 2 的声明是挂在路由上的静态属性，它看不见
路径参数里的分组名，一条路由声明不出两个码。
"""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, ok
from platform_server.apps.runtime_params.catalog import (
    DASHBOARD_EDIT,
    DASHBOARD_VIEW,
)
from platform_server.apps.runtime_params.deps import (
    get_session,
    get_settings,
    require,
)
from platform_server.apps.runtime_params.schemas import (
    RuntimeParamOut,
    RuntimeParamWriteIn,
)
from platform_server.apps.runtime_params.services import param_service
from platform_server.settings import API_PREFIX, Settings

router = APIRouter(
    prefix=f"{API_PREFIX}/runtime-params", tags=["runtime-param"]
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
ViewDep = Annotated[CallerContext, Depends(require(DASHBOARD_VIEW))]
WriteDep = Annotated[CallerContext, Depends(require(DASHBOARD_EDIT))]


@router.get(
    "",
    response_model=ApiResponse[list[RuntimeParamOut]],
    summary="运行参数目录与当前取值",
)
async def list_runtime_params(
    session: SessionDep,
    settings: SettingsDep,
    _viewer: ViewDep,
    section: str | None = None,
) -> ApiResponse[list[RuntimeParamOut]]:
    """列出运行参数。给了 `section` 就只回那一组。

    Args: session, settings, _viewer, section。
    """
    return ok(
        await param_service.read_items(
            session, settings=settings, section=section
        )
    )


@router.put(
    "/{section}",
    response_model=ApiResponse[list[RuntimeParamOut]],
    summary="修改一组运行参数",
)
async def replace_runtime_params(
    section: str,
    payload: RuntimeParamWriteIn,
    session: SessionDep,
    settings: SettingsDep,
    writer: WriteDep,
) -> ApiResponse[list[RuntimeParamOut]]:
    """改一个分组里的若干项。没给的项不动，改回默认值即删掉覆盖行。

    Args: section, payload, session, settings, writer。
    """
    state = await param_service.write_section(
        session,
        settings=settings,
        section=section,
        payload=payload,
        actor=str(writer.user_id),
    )
    return ok(state, message="运行参数已更新")


@router.post(
    "/{section}:reset",
    response_model=ApiResponse[list[RuntimeParamOut]],
    summary="恢复一组运行参数的默认值",
)
async def reset_runtime_params(
    section: str,
    session: SessionDep,
    settings: SettingsDep,
    writer: WriteDep,
) -> ApiResponse[list[RuntimeParamOut]]:
    """删掉该分组的覆盖行，此后重新跟随环境变量。

    Args: section, session, settings, writer。
    """
    state = await param_service.reset_section(
        session, settings=settings, section=section, actor=str(writer.user_id)
    )
    return ok(state, message="运行参数已恢复默认")
