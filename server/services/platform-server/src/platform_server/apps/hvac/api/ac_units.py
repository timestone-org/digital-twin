"""空调台账面。读用 `ac:view`，写用 `ac:manage`。

批量改派是动作端点（`:relocate`）而不是子资源：它不是「创建一个 relocate」，
把动词标出来能让路由表、日志与权限规则一眼看出这是一次批量写。
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, Page, PageParams, ok, page_params
from platform_server.apps.hvac.catalog import AC_MANAGE, AC_VIEW
from platform_server.apps.hvac.deps import get_session, require
from platform_server.apps.hvac.schemas import (
    AcUnitCreateIn,
    AcUnitFilters,
    AcUnitOut,
    AcUnitRelocateIn,
    AcUnitRelocateOut,
    AcUnitUpdateIn,
)
from platform_server.apps.hvac.services import ac_unit_service
from platform_server.settings import API_PREFIX

# ⚠ 前缀取到服务段为止：集合级动作端点 `/ac-units:relocate` 与集合本身同级，
# 挂在 `/ac-units` 前缀下就只能写成不合法的空路径。
router = APIRouter(prefix=API_PREFIX, tags=["ac-unit"])


def ac_unit_filters(
    q: str | None = None,
    room_id: uuid.UUID | None = None,
    workshop_id: uuid.UUID | None = None,
) -> AcUnitFilters:
    """把三个 query 参数收成一个过滤条件对象。

    Args: q, room_id, workshop_id。
    """
    return AcUnitFilters(keyword=q, room_id=room_id, workshop_id=workshop_id)


SessionDep = Annotated[AsyncSession, Depends(get_session)]
PageDep = Annotated[PageParams, Depends(page_params)]
FiltersDep = Annotated[AcUnitFilters, Depends(ac_unit_filters)]
ViewDep = Annotated[CallerContext, Depends(require(AC_VIEW))]
ManageDep = Annotated[CallerContext, Depends(require(AC_MANAGE))]


@router.get(
    "/ac-units", response_model=ApiResponse[Page[AcUnitOut]], summary="空调列表"
)
async def list_ac_units(
    session: SessionDep,
    page: PageDep,
    filters: FiltersDep,
    _viewer: ViewDep,
    sort: str | None = None,
) -> ApiResponse[Page[AcUnitOut]]:
    """分页列出空调，可按车间、房间与关键字过滤。

    Args: session, page, filters, _viewer, sort。
    """
    result = await ac_unit_service.list_ac_units(
        session, filters=filters, page=page, sort=sort
    )
    return ok(result)


@router.post(
    "/ac-units",
    response_model=ApiResponse[AcUnitOut],
    status_code=status.HTTP_201_CREATED,
    summary="建空调档案",
)
async def create_ac_unit(
    payload: AcUnitCreateIn,
    session: SessionDep,
    response: Response,
    _manager: ManageDep,
) -> ApiResponse[AcUnitOut]:
    """建空调。序号全场唯一，房间必填。

    Args: payload, session, response, _manager。
    """
    created = await ac_unit_service.create_ac_unit(session, payload=payload)
    response.headers["Location"] = f"{API_PREFIX}/ac-units/{created.id}"
    return ok(created, message="空调已建档")


@router.post(
    "/ac-units:relocate",
    response_model=ApiResponse[AcUnitRelocateOut],
    summary="批量改派空调所在房间",
)
async def relocate_ac_units(
    payload: AcUnitRelocateIn, session: SessionDep, _manager: ManageDep
) -> ApiResponse[AcUnitRelocateOut]:
    """把一批空调改派到同一个房间。任一 id 不存在即整批拒绝。

    Args: payload, session, _manager。
    """
    result = await ac_unit_service.relocate_ac_units(session, payload=payload)
    return ok(result, message="空调所在房间已更新")


@router.get(
    "/ac-units/{ac_unit_id}",
    response_model=ApiResponse[AcUnitOut],
    summary="空调详情",
)
async def read_ac_unit(
    ac_unit_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[AcUnitOut]:
    """空调详情。

    Args: ac_unit_id, session, _viewer。
    """
    return ok(await ac_unit_service.get_ac_unit(session, ac_unit_id))


@router.patch(
    "/ac-units/{ac_unit_id}",
    response_model=ApiResponse[AcUnitOut],
    summary="更新空调",
)
async def update_ac_unit(
    ac_unit_id: uuid.UUID,
    payload: AcUnitUpdateIn,
    session: SessionDep,
    _manager: ManageDep,
) -> ApiResponse[AcUnitOut]:
    """改空调。给了 `room_id` 就是把它挪到别的房间。

    Args: ac_unit_id, payload, session, _manager。
    """
    updated = await ac_unit_service.update_ac_unit(
        session, ac_unit_id=ac_unit_id, payload=payload
    )
    return ok(updated, message="空调已更新")


@router.delete(
    "/ac-units/{ac_unit_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除空调",
)
async def delete_ac_unit(
    ac_unit_id: uuid.UUID, session: SessionDep, _manager: ManageDep
) -> Response:
    """删空调。

    Args: ac_unit_id, session, _manager。
    """
    await ac_unit_service.delete_ac_unit(session, ac_unit_id=ac_unit_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
