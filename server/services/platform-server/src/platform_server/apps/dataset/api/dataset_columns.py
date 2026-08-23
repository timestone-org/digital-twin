"""列面。读用 `dataset:view`，增删改与重排用 `dataset:manage`。

⚠ 列挂在台账下面而不是做成顶层资源：`key` 只在一张台账内唯一，顶层资源就得
另发一个全局 id 才能指认（docs/DATASET_DESIGN.md §6）。
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, ok
from platform_server.apps.dataset.catalog import DATASET_VIEW
from platform_server.apps.dataset.deps import (
    WriteGate,
    get_manage_context,
    get_session,
    require,
)
from platform_server.apps.dataset.schemas import (
    ColumnCreateIn,
    ColumnOut,
    ColumnReorderIn,
    ColumnUpdateIn,
)
from platform_server.apps.dataset.services import column_service
from platform_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/dataset-tables", tags=["dataset-column"]
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ViewDep = Annotated[CallerContext, Depends(require(DATASET_VIEW))]
ManageDep = Annotated[WriteGate, Depends(get_manage_context)]


@router.get(
    "/{table_id}/columns",
    response_model=ApiResponse[list[ColumnOut]],
    summary="列列表",
)
async def list_columns(
    table_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[list[ColumnOut]]:
    """一张台账的全部列。集合有界，故不分页。

    Args: table_id, session, _viewer。
    """
    return ok(await column_service.list_columns(session, table_id=table_id))


@router.post(
    "/{table_id}/columns",
    response_model=ApiResponse[ColumnOut],
    status_code=status.HTTP_201_CREATED,
    summary="新增列",
)
async def create_column(
    table_id: uuid.UUID,
    payload: ColumnCreateIn,
    session: SessionDep,
    response: Response,
    write: ManageDep,
) -> ApiResponse[ColumnOut]:
    """新增一列。支持 `Idempotency-Key`。

    Args: table_id, payload, session, response, write。
    """
    created = await write.run_once(
        endpoint="create_dataset_column",
        model=ColumnOut,
        action=lambda: column_service.create_column(
            session, table_id=table_id, payload=payload
        ),
    )
    _set_location(response, table_id, created.id)
    return ok(created, message="台账列已创建")


@router.post(
    "/{table_id}/columns:reorder",
    response_model=ApiResponse[list[ColumnOut]],
    summary="整体重排列",
)
async def reorder_columns(
    table_id: uuid.UUID,
    payload: ColumnReorderIn,
    session: SessionDep,
    _write: ManageDep,
) -> ApiResponse[list[ColumnOut]]:
    """按给定顺序整体重排。名单外的列保持原样。

    Args: table_id, payload, session, _write。
    """
    ordered = await column_service.reorder_columns(
        session, table_id=table_id, payload=payload
    )
    return ok(ordered, message="台账列已重排")


@router.patch(
    "/{table_id}/columns/{column_id}",
    response_model=ApiResponse[ColumnOut],
    summary="更新列",
)
async def update_column(
    table_id: uuid.UUID,
    column_id: uuid.UUID,
    payload: ColumnUpdateIn,
    session: SessionDep,
    _write: ManageDep,
) -> ApiResponse[ColumnOut]:
    """改一列。`key` 不可改，故不在入参里。

    Args: table_id, column_id, payload, session, _write。
    """
    updated = await column_service.update_column(
        session, table_id=table_id, column_id=column_id, payload=payload
    )
    return ok(updated, message="台账列已更新")


@router.delete(
    "/{table_id}/columns/{column_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除列",
)
async def delete_column(
    table_id: uuid.UUID,
    column_id: uuid.UUID,
    session: SessionDep,
    _write: ManageDep,
    is_forced: Annotated[bool, Query(alias="force")] = False,
) -> Response:
    """删一列。被别的列的公式引用着就 409；`force` 跳过守卫。

    Args: table_id, column_id, session, _write, is_forced。
    """
    await column_service.delete_column(
        session,
        table_id=table_id,
        column_id=column_id,
        is_forced=is_forced,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _set_location(
    response: Response, table_id: uuid.UUID, column_id: uuid.UUID
) -> None:
    """201 要带上新资源的地址。

    Args: response, table_id, column_id。
    """
    response.headers["Location"] = (
        f"{API_PREFIX}/dataset-tables/{table_id}/columns/{column_id}"
    )
