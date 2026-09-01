"""检索面：对着一个库问一句话。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge.catalog import KNOWLEDGE_USE
from knowledge_server.apps.knowledge.schemas import (
    AskIn,
    AskOut,
    SearchIn,
    SearchOut,
)
from knowledge_server.apps.knowledge.services import search_service
from knowledge_server.apps.knowledge.services.assembly import Lanes, strategies
from knowledge_server.apps.knowledge.services.retrieval import (
    RetrievalStrategy,
)
from knowledge_server.container import Container
from knowledge_server.deps import get_container, get_session, require
from knowledge_server.settings import API_PREFIX
from lib.auth import CallerContext
from lib.web import ApiResponse, ok

router = APIRouter(prefix=f"{API_PREFIX}/knowledge-bases", tags=["search"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ContainerDep = Annotated[Container, Depends(get_container)]
UseDep = Annotated[CallerContext, Depends(require(KNOWLEDGE_USE))]


@router.post(
    "/{base_id}:search",
    response_model=ApiResponse[SearchOut],
    summary="在一个知识库里检索",
)
async def search(
    session: SessionDep,
    container: ContainerDep,
    _viewer: UseDep,
    base_id: uuid.UUID,
    body: SearchIn,
) -> ApiResponse[SearchOut]:
    """按库上配的（或这次点名的）策略召回几条，每条带够用来核对的出处。

    ⚠ 检索不了时回 409 而不是空表：空表与「确实没有相关内容」长得一模一样，
    而调用方会把它读成「查过了，没有」然后接着往下走。

    Args: session, container, _viewer, base_id, body。
    """
    return ok(
        await search_service.search(session, _lanes(container), base_id, body)
    )


@router.post(
    "/{base_id}:ask",
    response_model=ApiResponse[AskOut],
    summary="对着一个知识库提问",
)
async def ask(
    session: SessionDep,
    container: ContainerDep,
    _viewer: UseDep,
    base_id: uuid.UUID,
    body: AskIn,
) -> ApiResponse[AskOut]:
    """整套编排跑完：改写、召回、评分、补检、合成带角标的答案。

    ⚠ 只召回不作答的策略在这里回 409 并指路去 `:search`——回一个空答案的话，
    用户会以为库里没有，然后不再找了。

    Args: session, container, _viewer, base_id, body。
    """
    return ok(
        await search_service.ask(session, _lanes(container), base_id, body)
    )


def _lanes(container: Container) -> tuple[RetrievalStrategy, ...]:
    """这一次能用的那几种检索策略。

    Args: container。
    """
    return strategies(
        Lanes(
            settings=container.settings,
            probe=container.index,
            embedder=container.embedder,
            answerer=container.answerer,
        )
    )
