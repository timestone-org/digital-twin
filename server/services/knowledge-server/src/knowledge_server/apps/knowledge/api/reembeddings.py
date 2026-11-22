"""管理员预览、触发、观察与取消知识库整库重嵌。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge.crud import reembedding as jobs
from knowledge_server.apps.knowledge.schemas.reembedding import (
    ReembeddingJobOut,
    ReembeddingPreviewOut,
    ReembeddingStartIn,
)
from knowledge_server.apps.knowledge.services import (
    library_service,
    reembedding,
)
from knowledge_server.apps.knowledge.services.embedding import EmbeddingSpace
from knowledge_server.apps.knowledge.services.embedding.space import current
from knowledge_server.apps.knowledge.services.reembedding_receipt import (
    commit_job,
)
from knowledge_server.catalog import KNOWLEDGE_MANAGE
from knowledge_server.container import Container
from knowledge_server.deps import get_container, get_session, require
from knowledge_server.settings import API_PREFIX
from lib.auth import CallerContext
from lib.web import ApiResponse, Page, PageParams, ok, page_params
from llmcore.catalog_client import CatalogUnavailable

router = APIRouter(
    prefix=f"{API_PREFIX}/knowledge-bases", tags=["knowledge-reembedding"]
)
BASE = "/{base_id}/reembeddings"
SessionDep = Annotated[AsyncSession, Depends(get_session)]
ContainerDep = Annotated[Container, Depends(get_container)]
ManageDep = Annotated[CallerContext, Depends(require(KNOWLEDGE_MANAGE))]
KeyDep = Annotated[
    str,
    Header(
        alias="Idempotency-Key",
        min_length=1,
        max_length=256,
        pattern=r"^[!-~][ -~]*$",
    ),
]
PageDep = Annotated[PageParams, Depends(page_params)]


async def target(container: ContainerDep) -> EmbeddingSpace | None:
    """拉取当前登记的目标模型。Args: container。"""
    try:
        await container.catalog.confirm_current()
    except CatalogUnavailable:
        return None
    return current(container.embedder)


TargetDep = Annotated[EmbeddingSpace | None, Depends(target)]


@router.post(
    BASE + ":preview",
    response_model=ApiResponse[ReembeddingPreviewOut],
    summary="预览整库重嵌",
)
async def preview(
    base_id: uuid.UUID,
    session: SessionDep,
    _manager: ManageDep,
    selection: TargetDep,
) -> ApiResponse[ReembeddingPreviewOut]:
    """返回当前目标、源修订与工作量。

    Args: base_id, session, _manager, selection。
    """
    return ok(await reembedding.preview(session, base_id, selection))


def command(
    request: Request,
    actor: ManageDep,
    key: KeyDep,
    body: ReembeddingStartIn,
    base_id: uuid.UUID,
) -> reembedding.StartRequest:
    """绑定确认凭据与认证账号。

    Args: request, actor, key, body, base_id。
    """
    return reembedding.StartRequest(
        base_id,
        actor.user_id,
        key,
        body,
        request.client.host if request.client else None,
    )


StartDep = Annotated[reembedding.StartRequest, Depends(command)]


@router.post(
    BASE,
    response_model=ApiResponse[ReembeddingJobOut],
    status_code=status.HTTP_202_ACCEPTED,
    summary="启动整库重嵌",
)
async def start(
    request: StartDep,
    session: SessionDep,
    selection: TargetDep,
    response: Response,
    container: ContainerDep,
) -> ApiResponse[ReembeddingJobOut]:
    """先提交可恢复任务，再返回任务位置。

    Args: request, session, selection, response, container。
    """
    result = await reembedding.start(session, request, selection)
    result = await commit_job(session, container.database.session, result)
    response.headers["Location"] = (
        f"{API_PREFIX}/knowledge-bases/{request.base_id}/reembeddings/{result.id}"
    )
    return ok(result)


@router.get(
    BASE,
    response_model=ApiResponse[Page[ReembeddingJobOut]],
    summary="列出整库重嵌任务",
)
async def list_jobs(
    base_id: uuid.UUID, session: SessionDep, _manager: ManageDep, page: PageDep
) -> ApiResponse[Page[ReembeddingJobOut]]:
    """列出本库任务，最近创建的在前。

    Args: base_id, session, _manager, page。
    """
    await library_service.read_base(session, base_id)
    rows, total = await jobs.list_jobs(session, base_id, page.offset, page.size)
    return ok(
        Page(
            items=[ReembeddingJobOut.model_validate(row) for row in rows],
            total=total,
            page=page.page,
            size=page.size,
        )
    )


@router.get(
    BASE + "/{job_id}",
    response_model=ApiResponse[ReembeddingJobOut],
    summary="查看整库重嵌进度",
)
async def read(
    base_id: uuid.UUID,
    job_id: uuid.UUID,
    session: SessionDep,
    _manager: ManageDep,
) -> ApiResponse[ReembeddingJobOut]:
    """读取一份管理任务。

    Args: base_id, job_id, session, _manager。
    """
    return ok(await reembedding.read(session, base_id, job_id))


@router.post(
    BASE + "/{job_id}:cancel",
    response_model=ApiResponse[ReembeddingJobOut],
    summary="取消整库重嵌",
)
async def cancel(
    base_id: uuid.UUID,
    job_id: uuid.UUID,
    session: SessionDep,
    actor: ManageDep,
    request: Request,
) -> ApiResponse[ReembeddingJobOut]:
    """取消在途任务并保留当前索引。

    Args: base_id, job_id, session, actor, request。
    """
    ip = request.client.host if request.client else None
    result = await reembedding.cancel(
        session, base_id, job_id, actor.user_id, ip
    )
    result = await commit_job(
        session, get_container(request).database.session, result, is_cancel=True
    )
    return ok(result)
