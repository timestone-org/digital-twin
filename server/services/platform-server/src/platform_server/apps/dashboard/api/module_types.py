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
    ModuleTypeDetailOut,
    ModuleTypeOut,
)
from platform_server.apps.dashboard.services.module_catalog import ModuleCatalog
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
            field_types=list(catalog.field_types),
            binding_data_types=list(catalog.binding_data_types),
            chrome_keys=list(catalog.chrome_keys),
            modules=list(catalog.modules),
        )
    )


@router.get(
    "/{module_type}",
    response_model=ApiResponse[ModuleTypeDetailOut],
    summary="模块清单详情",
)
async def read_module_type(
    module_type: str, container: ContainerDep, _viewer: ViewDep
) -> ApiResponse[ModuleTypeDetailOut]:
    """单个模块类型的配置字段、绑定槽、预设，外加三张读它要用的图例。

    ⚠ 图例跟着详情一起给：Agent 要摆一个模块时只拉这一个，拉不到图例就只能
    猜每一格 `type` 是什么形状的值——而写错形状的值存得下去、也不报错。

    Args: module_type, container, _viewer。
    """
    module = container.module_catalog.find(module_type)
    if module is None:
        raise ModuleTypeNotFound("模块类型不存在")
    return ok(_with_legends(container.module_catalog, module))


def _with_legends(
    catalog: ModuleCatalog, module: ModuleTypeOut
) -> ModuleTypeDetailOut:
    """给一个模块清单配上三张图例。

    Args: catalog, module。
    """
    return ModuleTypeDetailOut(
        **module.model_dump(),
        field_types=list(catalog.field_types),
        binding_data_types=list(catalog.binding_data_types),
        chrome_keys=list(catalog.chrome_keys),
    )
