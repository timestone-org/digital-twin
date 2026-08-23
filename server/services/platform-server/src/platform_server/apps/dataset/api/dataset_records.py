"""记录面。读用 `dataset:view`，写单行用 `dataset:record:write`。

⚠ 编辑与删除都带 `?ts=`：`ts` 是分区键，带上直接命中 chunk
（docs/DATASET_DESIGN.md §6.1）。
⚠ 记录列表走**游标分页**：`dataset_records` 是持续写入的时序集合，页码分页会
静默重复与漏行（api-contract §5.1）。
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, CursorPage, CursorParams, cursor_params, ok
from platform_server.apps.dataset.catalog import DATASET_VIEW
from platform_server.apps.dataset.deps import (
    get_record_locator,
    get_record_writer,
    get_session,
    require,
)
from platform_server.apps.dataset.schemas import (
    RecordCreateIn,
    RecordDeleteOut,
    RecordOut,
    RecordUpdateIn,
    RecordWriteOut,
)
from platform_server.apps.dataset.services import (
    RecordLocator,
    RecordWriter,
    record_read,
    record_write,
)
from platform_server.apps.dataset.services.record_read import RecordFilters
from platform_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/dataset-tables", tags=["dataset-record"]
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]
CursorDep = Annotated[CursorParams, Depends(cursor_params)]
ViewDep = Annotated[CallerContext, Depends(require(DATASET_VIEW))]
WriteDep = Annotated[RecordWriter, Depends(get_record_writer)]
LocatorDep = Annotated[RecordLocator, Depends(get_record_locator)]


def list_filters(
    since: Annotated[str | None, Query()] = None,
    until: Annotated[str | None, Query()] = None,
) -> RecordFilters:
    """把两个时间过滤参数收成一件。

    Args: since, until。
    """
    return record_read.parse_filters(since=since, until=until)


FiltersDep = Annotated[RecordFilters, Depends(list_filters)]


@router.get(
    "/{table_id}/records",
    response_model=ApiResponse[CursorPage[RecordOut]],
    summary="数据行列表",
)
async def list_records(
    table_id: uuid.UUID,
    session: SessionDep,
    page: CursorDep,
    filters: FiltersDep,
    _viewer: ViewDep,
) -> ApiResponse[CursorPage[RecordOut]]:
    """按数据时间倒序翻页。**游标分页**，`after` 从上一页原样带回。

    Args: table_id, session, page, filters, _viewer。
    """
    return ok(
        await record_read.list_records(
            session, table_id=table_id, filters=filters, page=page
        )
    )


@router.post(
    "/{table_id}/records",
    response_model=ApiResponse[RecordWriteOut],
    status_code=status.HTTP_201_CREATED,
    summary="录入一行",
)
async def create_record(
    table_id: uuid.UUID,
    payload: RecordCreateIn,
    session: SessionDep,
    response: Response,
    writer: WriteDep,
) -> ApiResponse[RecordWriteOut]:
    """录入一行，公式列随之算出。

    Args: table_id, payload, session, response, writer。
    """
    created = await record_write.create_record(
        session, writer, table_id=table_id, payload=payload
    )
    response.headers["Location"] = (
        f"{API_PREFIX}/dataset-tables/{table_id}"
        f"/records/{created.record.row_id}"
    )
    return ok(created, message="数据行已录入")


@router.patch(
    "/{table_id}/records/{row_id}",
    response_model=ApiResponse[RecordWriteOut],
    summary="编辑一行",
)
async def update_record(
    payload: RecordUpdateIn,
    session: SessionDep,
    locator: LocatorDep,
    writer: WriteDep,
) -> ApiResponse[RecordWriteOut]:
    """改一行的原始值，可连带改数据时间。公式列随之重算。

    Args: payload, session, locator, writer。
    """
    saved = await record_write.update_record(
        session, writer, locator=locator, payload=payload
    )
    return ok(saved, message="数据行已更新")


@router.delete(
    "/{table_id}/records/{row_id}",
    response_model=ApiResponse[RecordDeleteOut],
    summary="删除一行",
)
async def delete_record(
    session: SessionDep, locator: LocatorDep, writer: WriteDep
) -> ApiResponse[RecordDeleteOut]:
    """删一行。回执带上「有没有让别的行的公式结果过期」。

    ⚠ 不是 204：删除同样会让下游过期，而那件事只能由回执说出来。
    Args: session, locator, writer。
    """
    removed = await record_write.delete_record(session, writer, locator=locator)
    return ok(removed, message="数据行已删除")
