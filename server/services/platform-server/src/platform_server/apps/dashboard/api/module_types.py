"""模块清单面 —— Agent 的地图。

没有它，Agent 要生成一张大屏就得先去读前端源码（ADR-0012 五）。
"""

from typing import Annotated

from fastapi import APIRouter, Depends

from lib.auth import CallerContext
from lib.web import ApiResponse, ok
from platform_server.apps.dashboard.catalog import DASHBOARD_VIEW
from platform_server.apps.dashboard.deps import get_container, require
from platform_server.apps.dashboard.errors import ModuleTypeNotFound
from platform_server.apps.dashboard.schemas import (
    ModuleCatalogOut,
    ModuleTypeOut,
)
from platform_server.container import Container
from platform_server.settings import API_PREFIX

router = APIRouter(prefix=f"{API_PREFIX}/module-types", tags=["module-type"])

ContainerDep = Annotated[Container, Depends(get_container)]
ViewDep = Annotated[CallerContext, Depends(require(DASHBOARD_VIEW))]


@router.get(
    "", response_model=ApiResponse[ModuleCatalogOut], summary="模块清单"
)
async def list_module_types(
    container: ContainerDep, _viewer: ViewDep
) -> ApiResponse[ModuleCatalogOut]:
    """全部模块类型及其配置字段与绑定槽。

    Args: container, _viewer。
    """
    catalog = container.module_catalog
    return ok(
        ModuleCatalogOut(
            catalog_version=catalog.catalog_version,
            modules=list(catalog.modules),
        )
    )


@router.get(
    "/{module_type}",
    response_model=ApiResponse[ModuleTypeOut],
    summary="模块清单详情",
)
async def read_module_type(
    module_type: str, container: ContainerDep, _viewer: ViewDep
) -> ApiResponse[ModuleTypeOut]:
    """单个模块类型的配置字段与绑定槽。

    Args: module_type, container, _viewer。
    """
    module = container.module_catalog.find(module_type)
    if module is None:
        raise ModuleTypeNotFound("模块类型不存在")
    return ok(module)
