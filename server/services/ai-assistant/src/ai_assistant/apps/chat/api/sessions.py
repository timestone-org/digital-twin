"""会话面：列、建、看、改、删。五条端点一律要 `assistant:use`。

⚠ 看不见的会话回 404 而不是 403——403 等于逐个 id 回答「这条对话确实存在」。
谁看得见谁的判定在 services 层，本层只把调用者身份转过去。
"""

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ai_assistant.apps.chat.catalog import ASSISTANT_USE
from ai_assistant.apps.chat.schemas import (
    SessionCreateIn,
    SessionDetailOut,
    SessionOut,
    SessionUpdateIn,
    SurfaceKind,
)
from ai_assistant.apps.chat.services import session_service
from ai_assistant.apps.chat.services.session_service import SessionFilters
from ai_assistant.container import Container
from ai_assistant.deps import (
    get_container,
    get_idempotency_key,
    get_session,
    require,
)
from ai_assistant.settings import API_PREFIX
from lib.auth import CallerContext
from lib.idempotency import IdempotencyStore
from lib.web import ApiResponse, Page, PageParams, ok, page_params

router = APIRouter(prefix=f"{API_PREFIX}/sessions", tags=["chat-session"])


@dataclass(frozen=True)
class WriteContext:
    """一次写请求要的三件事：谁在写、带没带幂等键、首次结果存哪。

    ⚠ 打成一包不是为了好看：路由函数的形参上限是 5，而写端点天然还要带上
    自己那一两件依赖。
    """

    idempotency: IdempotencyStore
    idempotency_key: str | None
    caller: CallerContext

    async def run_once[ResultT: BaseModel](
        self,
        *,
        endpoint: str,
        model: type[ResultT],
        action: Callable[[], Awaitable[ResultT]],
    ) -> ResultT:
        """带幂等键就只执行一次，重放直接返回首次结果。

        Args: endpoint, model, action。
        """
        return await self.idempotency.run_once(
            endpoint=endpoint,
            key=self.idempotency_key,
            caller=self.caller.user_id,
            model=model,
            action=action,
        )


def get_write_context(
    container: Annotated[Container, Depends(get_container)],
    caller: Annotated[CallerContext, Depends(require(ASSISTANT_USE))],
    idempotency_key: Annotated[str | None, Depends(get_idempotency_key)],
) -> WriteContext:
    """建会话用的写上下文。

    Args: container, caller, idempotency_key。
    """
    return WriteContext(
        idempotency=container.idempotency,
        idempotency_key=idempotency_key,
        caller=caller,
    )


def get_filters(
    surface_kind: Annotated[SurfaceKind | None, Query()] = None,
    is_archived: Annotated[bool | None, Query()] = None,
) -> SessionFilters:
    """列表的两个可选过滤条件。

    ⚠ 未登记的工作面在这里就被拒成 400：放行的话它匹配不到任何行，而界面上
    「我的会话全没了」与「这一页本来就没有会话」长得一模一样。
    Args: surface_kind, is_archived。
    """
    return SessionFilters(surface_kind=surface_kind, is_archived=is_archived)


SessionDep = Annotated[AsyncSession, Depends(get_session)]
PageDep = Annotated[PageParams, Depends(page_params)]
UseDep = Annotated[CallerContext, Depends(require(ASSISTANT_USE))]
WriteDep = Annotated[WriteContext, Depends(get_write_context)]
FilterDep = Annotated[SessionFilters, Depends(get_filters)]


@router.get(
    "", response_model=ApiResponse[Page[SessionOut]], summary="会话列表"
)
async def list_sessions(
    session: SessionDep, page: PageDep, caller: UseDep, filters: FilterDep
) -> ApiResponse[Page[SessionOut]]:
    """分页列出调用者看得见的会话。

    Args: session, page, caller, filters。
    """
    return ok(
        await session_service.list_sessions(
            session, caller=caller, filters=filters, page=page
        )
    )


@router.post(
    "",
    response_model=ApiResponse[SessionOut],
    status_code=status.HTTP_201_CREATED,
    summary="创建会话",
)
async def create_session(
    payload: SessionCreateIn,
    session: SessionDep,
    response: Response,
    write: WriteDep,
) -> ApiResponse[SessionOut]:
    """建会话。支持 `Idempotency-Key`。

    Args: payload, session, response, write。
    """
    created = await write.run_once(
        endpoint="create_chat_session",
        model=SessionOut,
        action=lambda: session_service.create_session(
            session, caller=write.caller, payload=payload
        ),
    )
    response.headers["Location"] = f"{API_PREFIX}/sessions/{created.id}"
    return ok(created, message="会话已创建")


@router.get(
    "/{session_id}",
    response_model=ApiResponse[SessionDetailOut],
    summary="会话详情",
)
async def read_session(
    session_id: uuid.UUID, session: SessionDep, caller: UseDep
) -> ApiResponse[SessionDetailOut]:
    """会话详情，连着全部消息与步骤。

    Args: session_id, session, caller。
    """
    return ok(
        await session_service.get_session(
            session, chat_session_id=session_id, caller=caller
        )
    )


@router.patch(
    "/{session_id}",
    response_model=ApiResponse[SessionOut],
    summary="更新会话",
)
async def update_session(
    session_id: uuid.UUID,
    payload: SessionUpdateIn,
    session: SessionDep,
    caller: UseDep,
) -> ApiResponse[SessionOut]:
    """改标题或归档。归档只是不再默认列出，历史一条都不删。

    Args: session_id, payload, session, caller。
    """
    updated = await session_service.update_session(
        session,
        chat_session_id=session_id,
        caller=caller,
        payload=payload,
    )
    return ok(updated, message="会话已更新")


@router.delete(
    "/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除会话",
)
async def delete_session(
    session_id: uuid.UUID, session: SessionDep, caller: UseDep
) -> Response:
    """删会话。消息与步骤跟着走。

    Args: session_id, session, caller。
    """
    await session_service.delete_session(
        session, chat_session_id=session_id, caller=caller
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
