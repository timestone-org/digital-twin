"""车间面。读用 `ac:view`，写用 `ac:manage`。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, Page, PageParams, ok, page_params
from platform_server.apps.hvac.catalog import AC_MANAGE, AC_VIEW
from platform_server.apps.hvac.deps import get_session, require
from platform_server.apps.hvac.schemas import (
    WorkshopCreateIn,
    WorkshopOut,
    WorkshopUpdateIn,
)
from platform_server.apps.hvac.services import workshop_service
from platform_server.settings import API_PREFIX

router = APIRouter(prefix=f"{API_PREFIX}/workshops", tags=["workshop"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
PageDep = Annotated[PageParams, Depends(page_params)]
ViewDep = Annotated[CallerContext, Depends(require(AC_VIEW))]
ManageDep = Annotated[CallerContext, Depends(require(AC_MANAGE))]


@router.get(
    "", response_model=ApiResponse[Page[WorkshopOut]], summary="车间列表"
)
async def list_workshops(
    session: SessionDep,
    page: PageDep,
    _viewer: ViewDep,
    q: str | None = None,
    sort: str | None = None,
) -> ApiResponse[Page[WorkshopOut]]:
    """分页列出车间。

    Args: session, page, _viewer, q, sort。
    """
    result = await workshop_service.list_workshops(
        session, keyword=q, page=page, sort=sort
    )
    return ok(result)


@router.post(
    "",
    response_model=ApiResponse[WorkshopOut],
    status_code=status.HTTP_201_CREATED,
    summary="创建车间",
)
async def create_workshop(
    payload: WorkshopCreateIn,
    session: SessionDep,
    response: Response,
    _manager: ManageDep,
) -> ApiResponse[WorkshopOut]:
    """建车间。车间名全场唯一。

    Args: payload, session, response, _manager。
    """
    created = await workshop_service.create_workshop(session, payload=payload)
    response.headers["Location"] = f"{API_PREFIX}/workshops/{created.id}"
    return ok(created, message="车间已创建")


@router.get(
    "/{workshop_id}",
    response_model=ApiResponse[WorkshopOut],
    summary="车间详情",
)
async def read_workshop(
    workshop_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[WorkshopOut]:
    """车间详情。

    Args: workshop_id, session, _viewer。
    """
    return ok(await workshop_service.get_workshop(session, workshop_id))


@router.patch(
    "/{workshop_id}",
    response_model=ApiResponse[WorkshopOut],
    summary="更新车间",
)
async def update_workshop(
    workshop_id: uuid.UUID,
    payload: WorkshopUpdateIn,
    session: SessionDep,
    _manager: ManageDep,
) -> ApiResponse[WorkshopOut]:
    """改车间。

    Args: workshop_id, payload, session, _manager。
    """
    updated = await workshop_service.update_workshop(
        session, workshop_id=workshop_id, payload=payload
    )
    return ok(updated, message="车间已更新")


@router.delete(
    "/{workshop_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除车间",
)
async def delete_workshop(
    workshop_id: uuid.UUID, session: SessionDep, _manager: ManageDep
) -> Response:
    """删车间。下面还有房间时先删房间。

    Args: workshop_id, session, _manager。
    """
    await workshop_service.delete_workshop(session, workshop_id=workshop_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
