"""台账面。读用 `dataset:view`，增删改用 `dataset:manage`。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, Page, PageParams, ok, page_params
from platform_server.apps.dataset.catalog import DATASET_VIEW
from platform_server.apps.dataset.deps import (
    WriteGate,
    get_manage_context,
    get_session,
    require,
)
from platform_server.apps.dataset.schemas import (
    TableCreateIn,
    TableOut,
    TableSummaryOut,
    TableUpdateIn,
)
from platform_server.apps.dataset.services import table_service
from platform_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/dataset-tables", tags=["dataset-table"]
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]
PageDep = Annotated[PageParams, Depends(page_params)]
ViewDep = Annotated[CallerContext, Depends(require(DATASET_VIEW))]
ManageDep = Annotated[WriteGate, Depends(get_manage_context)]


@router.get(
    "", response_model=ApiResponse[Page[TableSummaryOut]], summary="台账列表"
)
async def list_tables(
    session: SessionDep,
    page: PageDep,
    _viewer: ViewDep,
    q: str | None = None,
) -> ApiResponse[Page[TableSummaryOut]]:
    """分页列出台账。`q` 按名称与编码模糊搜。

    Args: session, page, _viewer, q。
    """
    return ok(
        await table_service.list_tables(
            session, keyword=q, page=page, sort=None
        )
    )


@router.post(
    "",
    response_model=ApiResponse[TableOut],
    status_code=status.HTTP_201_CREATED,
    summary="创建台账",
)
async def create_table(
    payload: TableCreateIn,
    session: SessionDep,
    response: Response,
    write: ManageDep,
) -> ApiResponse[TableOut]:
    """建台账。支持 `Idempotency-Key`。

    Args: payload, session, response, write。
    """
    created = await write.run_once(
        endpoint="create_dataset_table",
        model=TableOut,
        action=lambda: table_service.create_table(session, payload=payload),
    )
    response.headers["Location"] = f"{API_PREFIX}/dataset-tables/{created.id}"
    return ok(created, message="台账已创建")


@router.get(
    "/{table_id}", response_model=ApiResponse[TableOut], summary="台账详情"
)
async def read_table(
    table_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[TableOut]:
    """台账详情，连列定义一起给。

    Args: table_id, session, _viewer。
    """
    return ok(await table_service.get_table(session, table_id))


@router.patch(
    "/{table_id}", response_model=ApiResponse[TableOut], summary="更新台账"
)
async def update_table(
    table_id: uuid.UUID,
    payload: TableUpdateIn,
    session: SessionDep,
    _write: ManageDep,
) -> ApiResponse[TableOut]:
    """改台账。`code` 不可改，故不在入参里。

    Args: table_id, payload, session, _write。
    """
    updated = await table_service.update_table(
        session, table_id=table_id, payload=payload
    )
    return ok(updated, message="台账已更新")


@router.delete(
    "/{table_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除台账",
)
async def delete_table(
    table_id: uuid.UUID,
    session: SessionDep,
    _write: ManageDep,
    is_forced: Annotated[bool, Query(alias="force")] = False,
) -> Response:
    """删台账。下面还有数据行时先确认；`force` 连历史一起删。

    Args: table_id, session, _write, is_forced。
    """
    await table_service.delete_table(
        session, table_id=table_id, is_forced=is_forced
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
