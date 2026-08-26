"""点位面。读用 `collect:view`，增删改用 `collect:manage`，
下发写值用 `collect:operate` 且幂等键必填。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, Page, PageParams, ok, page_params
from platform_server.apps.collect.catalog import COLLECT_VIEW
from platform_server.apps.collect.deps import (
    WriteContext,
    get_manage_context,
    get_session,
    get_write_value_context,
    require,
)
from platform_server.apps.collect.schemas import (
    PointBatchOut,
    PointCreateIn,
    PointDeleteIn,
    PointOut,
    PointSavedOut,
    PointUpdateIn,
    WriteIn,
    WriteOut,
)
from platform_server.apps.collect.services import (
    field_service,
    point_service,
)
from platform_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/collect-points", tags=["collect-point"]
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]
PageDep = Annotated[PageParams, Depends(page_params)]
ViewDep = Annotated[CallerContext, Depends(require(COLLECT_VIEW))]
ManageDep = Annotated[WriteContext, Depends(get_manage_context)]
WriteValueDep = Annotated[WriteContext, Depends(get_write_value_context)]

REASON_POINT_CHANGED = "point_changed"


@router.get("", response_model=ApiResponse[Page[PointOut]], summary="点位列表")
async def list_points(
    session: SessionDep,
    page: PageDep,
    _viewer: ViewDep,
    source_id: uuid.UUID | None = None,
    q: str | None = None,
) -> ApiResponse[Page[PointOut]]:
    """分页列出点位。`q` 按名字与编码模糊搜，Agent 找点用它。

    Args: session, page, _viewer, source_id, q。
    """
    return ok(
        await point_service.list_points(
            session, source_id=source_id, keyword=q, page=page, sort=None
        )
    )


@router.post(
    "",
    response_model=ApiResponse[PointBatchOut],
    status_code=status.HTTP_201_CREATED,
    summary="批量创建点位",
)
async def create_points(
    payload: PointCreateIn,
    session: SessionDep,
    response: Response,
    write: ManageDep,
) -> ApiResponse[PointBatchOut]:
    """批量建点，保存前先让现场校验寻址串。支持 `Idempotency-Key`。

    Args: payload, session, response, write。
    """
    created = await write.run_once(
        endpoint="create_collect_points",
        model=PointBatchOut,
        action=lambda: point_service.create_points(
            session, bus=write.bus, payload=payload
        ),
    )
    await write.plans.notify(reason=REASON_POINT_CHANGED)
    _set_location(response, created)
    return ok(created, message="点位已创建")


@router.patch(
    "/{point_id}",
    response_model=ApiResponse[PointSavedOut],
    summary="更新点位",
)
async def update_point(
    point_id: uuid.UUID,
    payload: PointUpdateIn,
    session: SessionDep,
    write: ManageDep,
) -> ApiResponse[PointSavedOut]:
    """改点位。改了寻址串就重新校验一次。

    Args: point_id, payload, session, write。
    """
    saved = await point_service.update_point(
        session, bus=write.bus, point_id=point_id, payload=payload
    )
    await write.plans.notify(reason=REASON_POINT_CHANGED)
    return ok(saved, message="点位已更新")


@router.delete(
    "/{point_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除点位",
)
async def delete_point(
    point_id: uuid.UUID,
    session: SessionDep,
    write: ManageDep,
    is_forced: Annotated[bool, Query(alias="force")] = False,
) -> Response:
    """删点位。被大屏绑着就 409 并列出那些大屏；`force` 跳过绑定守卫。

    Args: point_id, session, write, is_forced。
    """
    await point_service.delete_point(
        session, point_id=point_id, is_forced=is_forced
    )
    await write.plans.notify(reason=REASON_POINT_CHANGED)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    ":batch-delete",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="批量删除点位",
)
async def batch_delete_points(
    payload: PointDeleteIn,
    session: SessionDep,
    write: ManageDep,
) -> Response:
    """批量删点。整批全删或全不删；被绑着就 409 并点名，`is_forced` 跳守卫。

    Args: payload, session, write。
    """
    await point_service.delete_points(
        session, point_ids=payload.point_ids, is_forced=payload.is_forced
    )
    await write.plans.notify(reason=REASON_POINT_CHANGED)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{point_id}:write",
    response_model=ApiResponse[WriteOut],
    summary="下发写值",
)
async def write_point(
    point_id: uuid.UUID,
    payload: WriteIn,
    session: SessionDep,
    write: WriteValueDep,
) -> ApiResponse[WriteOut]:
    """向现场下发一个写值。幂等键**必填**，超时按不可重试处理。

    Args: point_id, payload, session, write。
    """
    return ok(
        await write.run_once(
            endpoint="write_collect_point",
            model=WriteOut,
            action=lambda: field_service.write_point(
                session, bus=write.bus, point_id=point_id, value=payload.value
            ),
        ),
        message="写值已下发",
    )


def _set_location(response: Response, created: PointBatchOut) -> None:
    """只建了一条时才给 Location。

    ⚠ 批量建的是一组资源，指不出「那一个新资源」；硬指第一条会让客户端以为
    其余几条没建成。
    Args: response, created。
    """
    if len(created.items) == 1:
        first = created.items[0]
        response.headers["Location"] = f"{API_PREFIX}/collect-points/{first.id}"
