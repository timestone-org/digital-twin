"""知识库与来源的读写面。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge import crud
from knowledge_server.apps.knowledge.schemas import (
    KnowledgeBaseIn,
    KnowledgeBaseOut,
    SourceIn,
    SourceOut,
)
from knowledge_server.apps.knowledge.services import library_service
from knowledge_server.catalog import (
    KNOWLEDGE_MANAGE,
    KNOWLEDGE_USE,
)
from knowledge_server.container import Container
from knowledge_server.deps import get_container, get_session, require
from knowledge_server.settings import API_PREFIX
from lib.auth import CallerContext
from lib.web import ApiResponse, Page, PageParams, ok, page_params

router = APIRouter(prefix=f"{API_PREFIX}/knowledge-bases", tags=["library"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ContainerDep = Annotated[Container, Depends(get_container)]
UseDep = Annotated[CallerContext, Depends(require(KNOWLEDGE_USE))]
ManageDep = Annotated[CallerContext, Depends(require(KNOWLEDGE_MANAGE))]
PageDep = Annotated[PageParams, Depends(page_params)]


@router.post(
    "",
    response_model=ApiResponse[KnowledgeBaseOut],
    status_code=status.HTTP_201_CREATED,
    summary="建一个知识库",
)
async def create(
    session: SessionDep,
    container: ContainerDep,
    actor: ManageDep,
    body: KnowledgeBaseIn,
) -> ApiResponse[KnowledgeBaseOut]:
    """建库，并顺手建出上传那一路来源。

    ⚠ `owner_id` 转成字符串：那一列存的是字符串不是 UUID。不转的话 asyncpg
    在绑参那一步直接抛，报出来的是「expected str, got UUID」——只有真库逮得到。

    Args: session, container, actor, body。
    """
    embedding = library_service.EmbeddingChoice.of(container.embedding_choice())
    owner = str(actor.user_id)
    return ok(
        await library_service.create_base(session, body, owner, embedding)
    )


@router.get("", response_model=ApiResponse[Page[KnowledgeBaseOut]])
async def list_all(
    session: SessionDep, _viewer: UseDep, params: PageDep
) -> ApiResponse[Page[KnowledgeBaseOut]]:
    """列一页知识库。

    Args: session, _viewer, params。
    """
    rows, total = await crud.knowledge_base.list_bases(
        session, offset=params.offset, limit=params.size
    )
    return ok(await library_service.base_page(session, rows, params, total))


@router.get("/{base_id}", response_model=ApiResponse[KnowledgeBaseOut])
async def get_one(
    session: SessionDep, _viewer: UseDep, base_id: uuid.UUID
) -> ApiResponse[KnowledgeBaseOut]:
    """取一个知识库。

    Args: session, _viewer, base_id。
    """
    row = await library_service.read_base(session, base_id)
    counts = await crud.document.counts_by_base(session, [row.id])
    return ok(library_service.base_out(row, counts.get(row.id, 0)))


@router.delete("/{base_id}", status_code=status.HTTP_204_NO_CONTENT)
async def drop(
    session: SessionDep,
    container: ContainerDep,
    _actor: ManageDep,
    base_id: uuid.UUID,
) -> None:
    """删一个知识库。来源、文档、块随外键级联，原件在提交之后清。

    Args: session, container, _actor, base_id。
    """
    await library_service.drop_base(session, container.objectstore, base_id)


@router.get("/{base_id}/sources", response_model=ApiResponse[list[SourceOut]])
async def list_sources(
    session: SessionDep, _viewer: UseDep, base_id: uuid.UUID
) -> ApiResponse[list[SourceOut]]:
    """一个库下的全部来源。

    Args: session, _viewer, base_id。
    """
    await library_service.read_base(session, base_id)
    rows = await crud.source.list_sources(session, base_id)
    return ok([library_service.source_out(one) for one in rows])


@router.post(
    "/{base_id}/sources",
    response_model=ApiResponse[SourceOut],
    status_code=status.HTTP_201_CREATED,
)
async def add_source(
    session: SessionDep,
    _actor: ManageDep,
    base_id: uuid.UUID,
    body: SourceIn,
) -> ApiResponse[SourceOut]:
    """给一个库加一路来源。

    Args: session, _actor, base_id, body。
    """
    return ok(await library_service.add_source(session, base_id, body))
