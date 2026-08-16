"""数据源面。读用 `collect:view`，增删改用 `collect:manage`，
测试与浏览用 `collect:operate`。"""

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
    get_operate_context,
    get_session,
    get_source_context,
    require,
)
from platform_server.apps.collect.schemas import (
    BrowseIn,
    BrowseOut,
    ConnectivityOut,
    SourceCreateIn,
    SourceOut,
    SourceUpdateIn,
    SubtreeOut,
)
from platform_server.apps.collect.services import (
    field_service,
    source_service,
)
from platform_server.apps.collect.services.source_service import SourceContext
from platform_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/collect-sources", tags=["collect-source"]
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]
PageDep = Annotated[PageParams, Depends(page_params)]
ViewDep = Annotated[CallerContext, Depends(require(COLLECT_VIEW))]
ManageDep = Annotated[WriteContext, Depends(get_manage_context)]
ContextDep = Annotated[SourceContext, Depends(get_source_context)]
OperateDep = Annotated[WriteContext, Depends(get_operate_context)]

# 计划变更的原因，稳定字面量（日志与广播共用）
REASON_SOURCE_CHANGED = "source_changed"


def list_filters(
    q: str | None = None,
    protocol: str | None = None,
    is_enabled: bool | None = None,
) -> tuple[str | None, str | None, bool | None]:
    """列表页的三个筛选条件。

    ⚠ 收成一个依赖而不是三个形参：路由函数的形参上限是 5，而本条路由还要
    会话、出参上下文、分页与调用者四件。
    Args: q, protocol, is_enabled。
    """
    return q, protocol, is_enabled


FilterDep = Annotated[
    tuple[str | None, str | None, bool | None], Depends(list_filters)
]


@router.get(
    "", response_model=ApiResponse[Page[SourceOut]], summary="数据源列表"
)
async def list_sources(
    session: SessionDep,
    context: ContextDep,
    page: PageDep,
    _viewer: ViewDep,
    filters: FilterDep,
) -> ApiResponse[Page[SourceOut]]:
    """分页列出数据源，每行带上采集运行态。

    Args: session, context, page, _viewer, filters。
    """
    return ok(
        await source_service.list_sources(
            session, context, filters=filters, page=page, sort=None
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
    context: ContextDep,
    response: Response,
    write: ManageDep,
) -> ApiResponse[SourceOut]:
    """建数据源。支持 `Idempotency-Key`。

    Args: payload, session, context, response, write。
    """
    created = await _create_once(payload, session, context, write)
    await write.plans.notify(reason=REASON_SOURCE_CHANGED)
    _set_location(response, created.id)
    return ok(created, message="数据源已创建")


async def _create_once(
    payload: SourceCreateIn,
    session: AsyncSession,
    context: SourceContext,
    write: WriteContext,
) -> SourceOut:
    """带幂等键时只建一次。

    Args: payload, session, context, write。
    """
    return await write.run_once(
        endpoint="create_collect_source",
        model=SourceOut,
        action=lambda: source_service.create_source(
            session, context, payload=payload
        ),
    )


def _set_location(response: Response, source_id: uuid.UUID) -> None:
    """201 要带上新资源的地址。

    Args: response, source_id。
    """
    response.headers["Location"] = f"{API_PREFIX}/collect-sources/{source_id}"


@router.get(
    "/{source_id}",
    response_model=ApiResponse[SourceOut],
    summary="数据源详情",
)
async def read_source(
    source_id: uuid.UUID,
    session: SessionDep,
    context: ContextDep,
    _viewer: ViewDep,
) -> ApiResponse[SourceOut]:
    """数据源详情，带采集运行态。

    Args: source_id, session, context, _viewer。
    """
    return ok(await source_service.get_source(session, context, source_id))


@router.patch(
    "/{source_id}",
    response_model=ApiResponse[SourceOut],
    summary="更新数据源",
)
async def update_source(
    source_id: uuid.UUID,
    payload: SourceUpdateIn,
    session: SessionDep,
    context: ContextDep,
    write: ManageDep,
) -> ApiResponse[SourceOut]:
    """改数据源。

    Args: source_id, payload, session, context, write。
    """
    updated = await source_service.update_source(
        session, context, source_id=source_id, payload=payload
    )
    await write.plans.notify(reason=REASON_SOURCE_CHANGED)
    return ok(updated, message="数据源已更新")


@router.delete(
    "/{source_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除数据源",
)
async def delete_source(
    source_id: uuid.UUID,
    session: SessionDep,
    write: ManageDep,
    is_forced: Annotated[bool, Query(alias="force")] = False,
) -> Response:
    """删数据源。下面还有点位时先删点位；`force` 连点位一起删。

    Args: source_id, session, write, is_forced。
    """
    await source_service.delete_source(
        session, source_id=source_id, is_forced=is_forced
    )
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


@router.post(
    "/{source_id}:browse-subtree",
    response_model=ApiResponse[SubtreeOut],
    summary="一次收齐一棵子树",
)
async def browse_subtree(
    source_id: uuid.UUID,
    payload: BrowseIn,
    session: SessionDep,
    write: OperateDep,
) -> ApiResponse[SubtreeOut]:
    """勾一个上层节点时用：把它下面的整棵子树一次收齐。

    ⚠ 递归在**持有会话的采集进程**里做，不由客户端逐层拉：逐层拉一个几百
    节点的通道就是几百个串行请求，每一个都要过一遍边缘、总线与设备。
    ⚠ 不限条数，只受这次请求的时间预算约束；到点没走完 `is_truncated`
    为真——界面必须说出来。
    Args: source_id, payload, session, write。
    """
    outcome = await field_service.browse_subtree(
        session, bus=write.bus, source_id=source_id, parent=payload.parent
    )
    return ok(outcome)
