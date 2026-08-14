"""数据源面。读用 `collect:view`，增删改用 `collect:manage`，
测试与浏览用 `collect:operate`。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, Page, PageParams, ok, page_params
from platform_server.apps.collect.catalog import COLLECT_VIEW
from platform_server.apps.collect.deps import (
    WriteContext,
    get_manage_context,
    get_operate_context,
    get_session,
    require,
)
from platform_server.apps.collect.schemas import (
    BrowseIn,
    BrowseOut,
    ConnectivityOut,
    SourceCreateIn,
    SourceOut,
    SourceUpdateIn,
)
from platform_server.apps.collect.services import (
    field_service,
    source_service,
)
from platform_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/collect-sources", tags=["collect-source"]
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]
PageDep = Annotated[PageParams, Depends(page_params)]
ViewDep = Annotated[CallerContext, Depends(require(COLLECT_VIEW))]
ManageDep = Annotated[WriteContext, Depends(get_manage_context)]
OperateDep = Annotated[WriteContext, Depends(get_operate_context)]

# 计划变更的原因，稳定字面量（日志与广播共用）
REASON_SOURCE_CHANGED = "source_changed"


@router.get(
    "", response_model=ApiResponse[Page[SourceOut]], summary="数据源列表"
)
async def list_sources(
    session: SessionDep,
    page: PageDep,
    _viewer: ViewDep,
    q: str | None = None,
    protocol: str | None = None,
    is_enabled: bool | None = None,
) -> ApiResponse[Page[SourceOut]]:
    """分页列出数据源。

    Args: session, page, _viewer, q, protocol, is_enabled。
    """
    return ok(
        await source_service.list_sources(
            session, filters=(q, protocol, is_enabled), page=page, sort=None
        )
    )


@router.post(
    "",
    response_model=ApiResponse[SourceOut],
    status_code=status.HTTP_201_CREATED,
    summary="创建数据源",
)
async def create_source(
    payload: SourceCreateIn,
    session: SessionDep,
    response: Response,
    write: ManageDep,
) -> ApiResponse[SourceOut]:
    """建数据源。支持 `Idempotency-Key`。

    Args: payload, session, response, write。
    """
    created = await write.run_once(
        endpoint="create_collect_source",
        model=SourceOut,
        action=lambda: source_service.create_source(session, payload=payload),
    )
    await write.plans.notify(reason=REASON_SOURCE_CHANGED)
    response.headers["Location"] = f"{API_PREFIX}/collect-sources/{created.id}"
    return ok(created, message="数据源已创建")


@router.get(
    "/{source_id}",
    response_model=ApiResponse[SourceOut],
    summary="数据源详情",
)
async def read_source(
    source_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[SourceOut]:
    """数据源详情。

    Args: source_id, session, _viewer。
    """
    return ok(await source_service.get_source(session, source_id))


@router.patch(
    "/{source_id}",
    response_model=ApiResponse[SourceOut],
    summary="更新数据源",
)
async def update_source(
    source_id: uuid.UUID,
    payload: SourceUpdateIn,
    session: SessionDep,
    write: ManageDep,
) -> ApiResponse[SourceOut]:
    """改数据源。

    Args: source_id, payload, session, write。
    """
    updated = await source_service.update_source(
        session, source_id=source_id, payload=payload
    )
    await write.plans.notify(reason=REASON_SOURCE_CHANGED)
    return ok(updated, message="数据源已更新")


@router.delete(
    "/{source_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除数据源",
)
async def delete_source(
    source_id: uuid.UUID, session: SessionDep, write: ManageDep
) -> Response:
    """删数据源。下面还有点位时先删点位。

    Args: source_id, session, write。
    """
    await source_service.delete_source(session, source_id=source_id)
    await write.plans.notify(reason=REASON_SOURCE_CHANGED)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{source_id}:test",
    response_model=ApiResponse[ConnectivityOut],
    summary="连通性测试",
)
async def test_source(
    source_id: uuid.UUID, session: SessionDep, write: OperateDep
) -> ApiResponse[ConnectivityOut]:
    """走命令总线问采集侧能不能连上。不可达也是 200 + 结论。

    Args: source_id, session, write。
    """
    return ok(
        await field_service.test_source(
            session, bus=write.bus, source_id=source_id
        )
    )


@router.post(
    "/{source_id}:browse",
    response_model=ApiResponse[BrowseOut],
    summary="浏览地址空间",
)
async def browse_source(
    source_id: uuid.UUID,
    payload: BrowseIn,
    session: SessionDep,
    write: OperateDep,
) -> ApiResponse[BrowseOut]:
    """浏览地址空间。**平台侧不建连接**，由持有会话的采集进程执行。

    Args: source_id, payload, session, write。
    """
    return ok(
        await field_service.browse_source(
            session,
            bus=write.bus,
            source_id=source_id,
            parent=payload.parent,
        )
    )
