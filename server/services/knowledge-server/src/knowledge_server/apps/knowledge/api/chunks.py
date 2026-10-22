"""按知识库读取原块窗口，供检索消费者续读证据。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge.schemas.chunk import (
    ChunkWindowIn,
    ChunkWindowOut,
)
from knowledge_server.apps.knowledge.services import chunk_service
from knowledge_server.catalog import KNOWLEDGE_USE
from knowledge_server.deps import get_session, require
from knowledge_server.settings import API_PREFIX
from lib.auth import CallerContext
from lib.web import ApiResponse, ok

router = APIRouter(prefix=f"{API_PREFIX}/knowledge-bases", tags=["search"])
SessionDep = Annotated[AsyncSession, Depends(get_session)]
UseDep = Annotated[CallerContext, Depends(require(KNOWLEDGE_USE))]


@router.get(
    "/{base_id}/chunks/{chunk_id}", response_model=ApiResponse[ChunkWindowOut]
)
async def read_chunk(
    session: SessionDep,
    _viewer: UseDep,
    base_id: uuid.UUID,
    chunk_id: uuid.UUID,
    window: Annotated[ChunkWindowIn, Query()],
) -> ApiResponse[ChunkWindowOut]:
    """读取同一库内的原块窗口。

    Args: session, _viewer, base_id, chunk_id, window。
    """
    return ok(
        await chunk_service.read_window(session, base_id, chunk_id, window)
    )
