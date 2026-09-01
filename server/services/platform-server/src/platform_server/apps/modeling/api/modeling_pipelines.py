"""流水线面。

读用 `modeling:view`，增删改用 `modeling:manage`，发起运行用 `modeling:run`。
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, Page, PageParams, ok, page_params
from platform_server.apps.modeling.catalog import MODELING_VIEW
from platform_server.apps.modeling.deps import (
    WriteGate,
    get_manage_context,
    get_run_context,
    get_session,
    require,
)
from platform_server.apps.modeling.schemas import (
    GraphCheckOut,
    PipelineCreateIn,
    PipelineOut,
    PipelineSummaryOut,
    PipelineUpdateIn,
    RunOut,
    RunStartIn,
)
from platform_server.apps.modeling.services import (
    Actor,
    RunContext,
    pipeline_service,
    run_service,
)
from platform_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/modeling-pipelines", tags=["modeling-pipeline"]
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]
PageDep = Annotated[PageParams, Depends(page_params)]
ViewDep = Annotated[CallerContext, Depends(require(MODELING_VIEW))]
ManageDep = Annotated[WriteGate, Depends(get_manage_context)]
RunDep = Annotated[RunContext, Depends(get_run_context)]


@router.get(
    "",
    response_model=ApiResponse[Page[PipelineSummaryOut]],
    summary="流水线列表",
)
async def list_pipelines(
    session: SessionDep,
    page: PageDep,
    _viewer: ViewDep,
    q: str | None = None,
) -> ApiResponse[Page[PipelineSummaryOut]]:
    """分页列出流水线。`q` 按名称与编码模糊搜。

    Args: session, page, _viewer, q。
    """
    return ok(
        await pipeline_service.list_pipelines(session, keyword=q, page=page)
    )


@router.post(
    "",
    response_model=ApiResponse[PipelineOut],
    status_code=status.HTTP_201_CREATED,
    summary="创建流水线",
)
async def create_pipeline(
    payload: PipelineCreateIn,
    session: SessionDep,
    response: Response,
    write: ManageDep,
) -> ApiResponse[PipelineOut]:
    """建流水线。支持 `Idempotency-Key`。

    Args: payload, session, response, write。
    """
    created = await write.run_once(
        endpoint="modeling.create_pipeline",
        model=PipelineOut,
        action=lambda: pipeline_service.create_pipeline(
            session, payload=payload, actor=_actor(write)
        ),
    )
    response.status_code = status.HTTP_201_CREATED
    return ok(created)


@router.get(
    "/{pipeline_id}",
    response_model=ApiResponse[PipelineOut],
    summary="流水线详情",
)
async def get_pipeline(
    pipeline_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[PipelineOut]:
    """详情，带整张图。

    Args: pipeline_id, session, _viewer。
    """
    return ok(await pipeline_service.get_pipeline(session, pipeline_id))


@router.patch(
    "/{pipeline_id}",
    response_model=ApiResponse[PipelineOut],
    summary="保存流水线",
)
async def update_pipeline(
    pipeline_id: uuid.UUID,
    payload: PipelineUpdateIn,
    session: SessionDep,
    _write: ManageDep,
) -> ApiResponse[PipelineOut]:
    """整体保存。`code` 不可改。

    Args: pipeline_id, payload, session, _write。
    """
    return ok(
        await pipeline_service.update_pipeline(
            session, pipeline_id=pipeline_id, payload=payload
        )
    )


@router.delete(
    "/{pipeline_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除流水线",
)
async def delete_pipeline(
    pipeline_id: uuid.UUID, session: SessionDep, _write: ManageDep
) -> Response:
    """删流水线。还有模型版本时 409。

    Args: pipeline_id, session, _write。
    """
    await pipeline_service.delete_pipeline(session, pipeline_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{pipeline_id}:validate",
    response_model=ApiResponse[GraphCheckOut],
    summary="校验流水线",
)
async def validate_pipeline(
    pipeline_id: uuid.UUID, session: SessionDep, _write: ManageDep
) -> ApiResponse[GraphCheckOut]:
    """把图的问题一次列全。与保存、导入、运行前用的是同一份实现。

    Args: pipeline_id, session, _write。
    """
    return ok(await pipeline_service.check_pipeline(session, pipeline_id))


@router.post(
    "/{pipeline_id}:run",
    response_model=ApiResponse[RunOut],
    status_code=status.HTTP_202_ACCEPTED,
    summary="发起运行",
)
async def start_run(
    pipeline_id: uuid.UUID,
    payload: RunStartIn,
    session: SessionDep,
    context: RunDep,
    response: Response,
) -> ApiResponse[RunOut]:
    """发起一次运行。同一条流水线已有在途运行时 409。

    Args: pipeline_id, payload, session, context, response。
    """
    run = await run_service.start_run(
        session, pipeline_id=pipeline_id, payload=payload, context=context
    )
    response.status_code = status.HTTP_202_ACCEPTED
    return ok(run)


def _actor(write: WriteGate) -> Actor:
    """写这一笔的人。

    Args: write。
    """
    return Actor(user_id=str(write.caller.user_id), name=write.caller.username)
