"""台账采集那一组运行参数。读用 `dataset:view`，写用 `dataset:manage`。

参数目录与读写编排复用 `apps/runtime_params` 的 services 公开面；这条路由单列
是因为写权限码不同——闸 2 的声明是挂在路由上的静态属性，一条路由声明不出两个码。

⚠ 路径挂在 `dataset-tables/` 之下而不是另起一个顶层资源段：闸 1 的规则表在
**auth-server**，`dataset-tables*` 那一摞已经把「GET → dataset:view、其余 →
dataset:manage」的阶梯铺好了，正是这一面要的两个码。另起一个顶层的
`dataset-runtime-params` 就要在另一个服务里补一条规则，而没补上的表现是它掉进
900 那条按方法兜底的规则——「改台账采集节拍要 `ac:manage`」，管空调的人能改、
管台账的人反而不能。

⚠ 这条路由必须登记在 `dataset_tables.router` **之前**：`GET /dataset-tables/
{table_id}` 的 `table_id` 是 UUID，`runtime-params` 落到它身上是一条 422，
不会回落到本路由。顺序由 tests/contract 里的路由用例钉着。
"""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, ok
from platform_server.apps.dataset.catalog import DATASET_MANAGE, DATASET_VIEW
from platform_server.apps.dataset.deps import (
    get_container,
    get_session,
    require,
)
from platform_server.apps.runtime_params.services import (
    DATASET_SCOPE,
    RuntimeParamOut,
    RuntimeParamWriteIn,
    param_service,
)
from platform_server.container import Container
from platform_server.settings import API_PREFIX, Settings

router = APIRouter(
    prefix=f"{API_PREFIX}/dataset-tables/runtime-params",
    tags=["dataset-table"],
)


def get_settings(
    container: Annotated[Container, Depends(get_container)],
) -> Settings:
    """取本进程的配置对象（默认值每次现取，不是启动时抄一份）。

    Args: container。
    """
    return container.settings


SessionDep = Annotated[AsyncSession, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_settings)]
ViewDep = Annotated[CallerContext, Depends(require(DATASET_VIEW))]
WriteDep = Annotated[CallerContext, Depends(require(DATASET_MANAGE))]


@router.get(
    "",
    response_model=ApiResponse[list[RuntimeParamOut]],
    summary="台账采集运行参数目录与当前取值",
)
async def list_dataset_runtime_params(
    session: SessionDep,
    settings: SettingsDep,
    _viewer: ViewDep,
    section: str | None = None,
) -> ApiResponse[list[RuntimeParamOut]]:
    """列出台账采集那一组运行参数。给了 `section` 就只回那一组。

    Args: session, settings, _viewer, section。
    """
    return ok(
        await param_service.read_items(
            session, settings=settings, section=section, scope=DATASET_SCOPE
        )
    )


@router.put(
    "/{section}",
    response_model=ApiResponse[list[RuntimeParamOut]],
    summary="修改一组台账采集运行参数",
)
async def replace_dataset_runtime_params(
    section: str,
    payload: RuntimeParamWriteIn,
    session: SessionDep,
    settings: SettingsDep,
    writer: WriteDep,
) -> ApiResponse[list[RuntimeParamOut]]:
    """改一个分组里的若干项。没给的项不动，改回默认值即删掉覆盖行。

    Args: section, payload, session, settings, writer。
    """
    param_service.require_in_scope(section, DATASET_SCOPE)
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
    summary="恢复一组台账采集运行参数的默认值",
)
async def reset_dataset_runtime_params(
    section: str,
    session: SessionDep,
    settings: SettingsDep,
    writer: WriteDep,
) -> ApiResponse[list[RuntimeParamOut]]:
    """删掉该分组的覆盖行，此后重新跟随环境变量。

    Args: section, session, settings, writer。
    """
    param_service.require_in_scope(section, DATASET_SCOPE)
    state = await param_service.reset_section(
        session, settings=settings, section=section, actor=str(writer.user_id)
    )
    return ok(state, message="运行参数已恢复默认")
