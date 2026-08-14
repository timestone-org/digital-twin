"""房间面。读用 `ac:view`，写用 `ac:manage`。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, Page, PageParams, ok, page_params
from platform_server.apps.hvac.catalog import AC_MANAGE, AC_VIEW
from platform_server.apps.hvac.deps import get_session, require
from platform_server.apps.hvac.schemas import (
    RoomCreateIn,
    RoomOut,
    RoomUpdateIn,
)
from platform_server.apps.hvac.services import room_service
from platform_server.settings import API_PREFIX

router = APIRouter(prefix=f"{API_PREFIX}/rooms", tags=["room"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
PageDep = Annotated[PageParams, Depends(page_params)]
ViewDep = Annotated[CallerContext, Depends(require(AC_VIEW))]
ManageDep = Annotated[CallerContext, Depends(require(AC_MANAGE))]


@router.get("", response_model=ApiResponse[Page[RoomOut]], summary="房间列表")
async def list_rooms(
    session: SessionDep,
    page: PageDep,
    _viewer: ViewDep,
    workshop_id: uuid.UUID | None = None,
    q: str | None = None,
    sort: str | None = None,
) -> ApiResponse[Page[RoomOut]]:
    """分页列出房间，可按车间过滤。

    Args: session, page, _viewer, workshop_id, q, sort。
    """
    result = await room_service.list_rooms(
        session, workshop_id=workshop_id, keyword=q, page=page, sort=sort
    )
    return ok(result)


@router.post(
    "",
    response_model=ApiResponse[RoomOut],
    status_code=status.HTTP_201_CREATED,
    summary="创建房间",
)
async def create_room(
    payload: RoomCreateIn,
    session: SessionDep,
    response: Response,
    _manager: ManageDep,
) -> ApiResponse[RoomOut]:
    """建房间。房间名只在所属车间内唯一。

    Args: payload, session, response, _manager。
    """
    created = await room_service.create_room(session, payload=payload)
    response.headers["Location"] = f"{API_PREFIX}/rooms/{created.id}"
    return ok(created, message="房间已创建")


@router.get(
    "/{room_id}", response_model=ApiResponse[RoomOut], summary="房间详情"
)
async def read_room(
    room_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[RoomOut]:
    """房间详情。

    Args: room_id, session, _viewer。
    """
    return ok(await room_service.get_room(session, room_id))


@router.patch(
    "/{room_id}", response_model=ApiResponse[RoomOut], summary="更新房间"
)
async def update_room(
    room_id: uuid.UUID,
    payload: RoomUpdateIn,
    session: SessionDep,
    _manager: ManageDep,
) -> ApiResponse[RoomOut]:
    """改房间。

    Args: room_id, payload, session, _manager。
    """
    updated = await room_service.update_room(
        session, room_id=room_id, payload=payload
    )
    return ok(updated, message="房间已更新")


@router.delete(
    "/{room_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除房间",
)
async def delete_room(
    room_id: uuid.UUID, session: SessionDep, _manager: ManageDep
) -> Response:
    """删房间。里面还有空调时先改派。

    Args: room_id, session, _manager。
    """
    await room_service.delete_room(session, room_id=room_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
