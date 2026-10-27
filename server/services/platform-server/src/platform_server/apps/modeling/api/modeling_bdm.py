"""BDM 目录读面；沿用建模查看权限，不向浏览器提供外部凭据。"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from lib.auth import CallerContext
from lib.web import ApiResponse, ok
from platform_server.apps.modeling.catalog import MODELING_VIEW
from platform_server.apps.modeling.deps import get_container, require
from platform_server.apps.modeling.schemas.bdm import (
    BdmCatalogOut,
    BdmCatalogQuery,
)
from platform_server.apps.modeling.services.bdm_catalog import read_catalog
from platform_server.apps.modeling.services.bdm_client import (
    BdmConnection,
    configured_connection,
)
from platform_server.container import Container
from platform_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/modeling-bdm-catalogs", tags=["modeling-bdm"]
)
ViewDep = Annotated[CallerContext, Depends(require(MODELING_VIEW))]


def get_bdm_connection(
    container: Annotated[Container, Depends(get_container)],
) -> BdmConnection | None:
    return configured_connection(container.settings)


@router.get(
    "", response_model=ApiResponse[BdmCatalogOut], summary="BDM 取数目录"
)
async def list_bdm_catalog(
    _viewer: ViewDep,
    query: Annotated[BdmCatalogQuery, Query()],
    connection: Annotated[BdmConnection | None, Depends(get_bdm_connection)],
) -> ApiResponse[BdmCatalogOut]:
    return ok(await read_catalog(connection, query))
