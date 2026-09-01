"""文档的读写面：签直传凭证、登记、列、删、重新解析。

⚠ 文档挂在**顶层**而不是 `/knowledge-bases/{id}/documents/{id}`：嵌套超过两层
之后，「按状态筛所有库的文档」这类查询就没地方放了（api-contract §1）。
库的归属走 `base_id` 过滤。
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge import crud
from knowledge_server.apps.knowledge.catalog import (
    KNOWLEDGE_USE,
    KNOWLEDGE_WRITE,
)
from knowledge_server.apps.knowledge.schemas import (
    DocumentOut,
    RegisterDocumentIn,
    UploadTicketIn,
    UploadTicketOut,
    checked_status,
)
from knowledge_server.apps.knowledge.services import (
    document_service,
    library_service,
)
from knowledge_server.container import Container
from knowledge_server.deps import get_container, get_session, require
from knowledge_server.settings import API_PREFIX
from lib.auth import CallerContext
from lib.web import ApiResponse, Page, PageParams, ok, page_params

router = APIRouter(prefix=f"{API_PREFIX}/documents", tags=["document"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ContainerDep = Annotated[Container, Depends(get_container)]
UseDep = Annotated[CallerContext, Depends(require(KNOWLEDGE_USE))]
WriteDep = Annotated[CallerContext, Depends(require(KNOWLEDGE_WRITE))]
PageDep = Annotated[PageParams, Depends(page_params)]


@router.post(
    ":upload-ticket",
    response_model=ApiResponse[UploadTicketOut],
    status_code=status.HTTP_201_CREATED,
    summary="申请直传凭证",
)
async def upload_ticket(
    session: SessionDep,
    container: ContainerDep,
    _actor: WriteDep,
    base_id: Annotated[uuid.UUID, Query()],
    body: UploadTicketIn,
) -> ApiResponse[UploadTicketOut]:
    """铸一个文档 id 并签一张把键、类型与大小都钉死的直传表单。

    ⚠ 本步**不落行**：没传成的文档不会在库里留下半条记录，界面上也就不会
    出现一份永远停在 pending 的鬼影。认不出的格式在这一步就拒——让用户传完
    200 MB 再说「不收这种格式」是两次浪费。

    Args: session, container, _actor, base_id, body。
    """
    await library_service.read_base(session, base_id)
    store = container.objectstore
    return ok(await document_service.presign_upload(store, base_id, body))


@router.post(
    "",
    response_model=ApiResponse[DocumentOut],
    status_code=status.HTTP_201_CREATED,
    summary="确认直传完成",
)
async def register(
    session: SessionDep,
    container: ContainerDep,
    _actor: WriteDep,
    base_id: Annotated[uuid.UUID, Query()],
    body: RegisterDocumentIn,
) -> ApiResponse[DocumentOut]:
    """算哈希、挪进正式键、落一行文档，提交之后投摄取任务。

    Args: session, container, _actor, base_id, body。
    """
    await library_service.read_base(session, base_id)
    made = await document_service.register_upload(
        session, container.objectstore, base_id, body
    )
    document_service.queue_ingest(
        session, container.stream, container.ingest_group(), made
    )
    return ok(made)


@router.get("", response_model=ApiResponse[Page[DocumentOut]])
async def list_all(
    session: SessionDep,
    _viewer: UseDep,
    params: PageDep,
    base_id: Annotated[uuid.UUID, Query()],
    status_filter: Annotated[str, Query(alias="status")] = "",
) -> ApiResponse[Page[DocumentOut]]:
    """列一个库下的文档，可按摄取状态筛。

    Args: session, _viewer, params, base_id, status_filter。
    """
    rows, total = await crud.document.list_documents(
        session,
        base_id,
        checked_status(status_filter),
        (params.offset, params.size),
    )
    return ok(document_service.document_page(rows, params, total))


@router.get("/{document_id}", response_model=ApiResponse[DocumentOut])
async def get_one(
    session: SessionDep, _viewer: UseDep, document_id: uuid.UUID
) -> ApiResponse[DocumentOut]:
    """取一份文档。

    Args: session, _viewer, document_id。
    """
    row = await document_service.read_document(session, document_id)
    return ok(document_service.document_out(row))


@router.post(
    "/{document_id}:reparse",
    response_model=ApiResponse[DocumentOut],
    summary="重新解析",
)
async def reparse(
    session: SessionDep,
    container: ContainerDep,
    _actor: WriteDep,
    document_id: uuid.UUID,
) -> ApiResponse[DocumentOut]:
    """把一份文档退回待处理并重新排队。

    ⚠ 这是这条链路上**唯一**的重试入口，而且它由人按：一份解不动的文档
    自动重试一万次也解不动，只会把 worker 占满。

    Args: session, container, _actor, document_id。
    """
    return ok(
        await document_service.requeue_document(
            session, container.stream, container.ingest_group(), document_id
        )
    )


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def drop(
    session: SessionDep,
    container: ContainerDep,
    _actor: WriteDep,
    document_id: uuid.UUID,
) -> None:
    """删一份文档：先删行，提交之后再清原件。

    Args: session, container, _actor, document_id。
    """
    await document_service.drop_document(
        session, container.objectstore, document_id
    )
