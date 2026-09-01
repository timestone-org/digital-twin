"""运行面。读用 `modeling:view`，取消用 `modeling:run`。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, Page, PageParams, ok, page_params
from platform_server.apps.modeling.catalog import MODELING_VIEW
from platform_server.apps.modeling.deps import (
    get_run_context,
    get_session,
    require,
)
from platform_server.apps.modeling.schemas import (
    NodeRunOut,
    RunOut,
    RunSummaryOut,
)
from platform_server.apps.modeling.services import RunContext, run_service
from platform_server.settings import API_PREFIX

router = APIRouter(prefix=f"{API_PREFIX}/modeling-runs", tags=["modeling-run"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
PageDep = Annotated[PageParams, Depends(page_params)]
ViewDep = Annotated[CallerContext, Depends(require(MODELING_VIEW))]
RunDep = Annotated[RunContext, Depends(get_run_context)]


@router.get(
    "",
    response_model=ApiResponse[Page[RunSummaryOut]],
    summary="运行列表",
)
async def list_runs(
    session: SessionDep,
    page: PageDep,
    _viewer: ViewDep,
    pipeline_id: uuid.UUID | None = None,
) -> ApiResponse[Page[RunSummaryOut]]:
    """分页列出运行记录，可按流水线筛。

    Args: session, page, _viewer, pipeline_id。
    """
    return ok(
        await run_service.list_runs(session, pipeline_id=pipeline_id, page=page)
    )


@router.get(
    "/{run_id}",
    response_model=ApiResponse[RunOut],
    summary="运行详情",
)
async def get_run(
    run_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[RunOut]:
    """状态 + 节点清单 + 当时那份图。**不含结果摘要**，前端每秒轮询它。

    Args: run_id, session, _viewer。
    """
    return ok(await run_service.get_run(session, run_id))


@router.get(
    "/{run_id}/nodes/{node_id}",
    response_model=ApiResponse[NodeRunOut],
    summary="节点结果",
)
async def get_node_run(
    run_id: uuid.UUID,
    node_id: str,
    session: SessionDep,
    _viewer: ViewDep,
) -> ApiResponse[NodeRunOut]:
    """单个节点的中间结果，按节点懒加载。

    Args: run_id, node_id, session, _viewer。
    """
    return ok(
        await run_service.get_node_run(session, run_id=run_id, node_id=node_id)
    )


@router.post(
    "/{run_id}:cancel",
    response_model=ApiResponse[RunOut],
    summary="取消运行",
)
async def cancel_run(
    run_id: uuid.UUID, session: SessionDep, _context: RunDep
) -> ApiResponse[RunOut]:
    """请求取消。终态在下一个节点边界才落，中间态是 `cancelling`。

    Args: run_id, session, _context。
    """
    return ok(await run_service.cancel_run(session, run_id))
