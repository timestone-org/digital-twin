"""权限目录（只读）。

⚠ 读码是 `user:view` **或** `role:manage`：配角色的人不一定有用户面的读码，
但角色编辑弹窗必须铺得出权限树。
"""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from auth_server.apps.auth.catalog import ROLE_MANAGE, USER_VIEW
from auth_server.apps.auth.deps import get_session, require
from auth_server.apps.auth.schemas import PermissionCatalogOut
from auth_server.apps.auth.services import Identity, permission_service
from auth_server.settings import API_PREFIX
from lib.web import ApiResponse, ok

router = APIRouter(prefix=f"{API_PREFIX}/permissions", tags=["permission"])

CatalogReaderDep = Annotated[
    Identity, Depends(require(USER_VIEW, ROLE_MANAGE, mode="any"))
]


@router.get(
    "",
    response_model=ApiResponse[PermissionCatalogOut],
    summary="权限目录",
)
async def read_catalog(
    session: Annotated[AsyncSession, Depends(get_session)],
    _reader: CatalogReaderDep,
) -> ApiResponse[PermissionCatalogOut]:
    """扁平表与分组视图各给一份。

    Args: session, _reader。
    """
    return ok(await permission_service.get_catalog(session))
