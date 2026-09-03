"""会话面：列、建、看、改、删。五条端点一律要 `knowledge:use`。

⚠ 看不见的会话回 404 而不是 403——403 等于逐个 id 回答「这条对话确实存在」。
谁看得见谁的判定在 services 层，本层只把调用者身份转过去。
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.chat.deps import WriteContext, get_write_context
from knowledge_server.apps.chat.schemas import (
    ChatSessionCreateIn,
    ChatSessionDetailOut,
    ChatSessionOut,
    ChatSessionUpdateIn,
)
from knowledge_server.apps.chat.services import session_service
from knowledge_server.catalog import KNOWLEDGE_USE
from knowledge_server.deps import get_session, require
from knowledge_server.settings import API_PREFIX
from lib.auth import CallerContext
from lib.web import ApiResponse, Page, PageParams, ok, page_params

router = APIRouter(prefix=f"{API_PREFIX}/chat-sessions", tags=["chat"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
PageDep = Annotated[PageParams, Depends(page_params)]
UseDep = Annotated[CallerContext, Depends(require(KNOWLEDGE_USE))]
WriteDep = Annotated[WriteContext, Depends(get_write_context)]
ArchivedDep = Annotated[bool | None, Query()]


@router.get(
    "", response_model=ApiResponse[Page[ChatSessionOut]], summary="对话列表"
)
async def list_sessions(
    session: SessionDep,
    page: PageDep,
    caller: UseDep,
    is_archived: ArchivedDep = None,
) -> ApiResponse[Page[ChatSessionOut]]:
    """分页列出调用者看得见的对话。

    Args: session, page, caller, is_archived。
    """
    return ok(
        await session_service.list_sessions(
            session, caller=caller, is_archived=is_archived, page=page
        )
    )


@router.post(
    "",
    response_model=ApiResponse[ChatSessionOut],
    status_code=status.HTTP_201_CREATED,
    summary="新建对话",
)
async def create_session(
    payload: ChatSessionCreateIn,
    session: SessionDep,
    response: Response,
    write: WriteDep,
) -> ApiResponse[ChatSessionOut]:
    """建对话；支持 `Idempotency-Key`。不给范围就是全部知识库。

    Args: payload, session, response, write。
    """
    created = await write.run_once(
        endpoint="create_kb_chat_session",
        model=ChatSessionOut,
        action=lambda: session_service.create_session(
            session, caller=write.caller, payload=payload
        ),
    )
    response.headers["Location"] = f"{API_PREFIX}/chat-sessions/{created.id}"
    return ok(created, message="对话已创建")


@router.get(
    "/{session_id}",
    response_model=ApiResponse[ChatSessionDetailOut],
    summary="对话详情",
)
async def read_session(
    session_id: uuid.UUID, session: SessionDep, caller: UseDep
) -> ApiResponse[ChatSessionDetailOut]:
    """对话详情，连着全部消息与步骤。

    Args: session_id, session, caller。
    """
    return ok(
        await session_service.get_session(
            session, chat_session_id=session_id, caller=caller
        )
    )


@router.patch(
    "/{session_id}",
    response_model=ApiResponse[ChatSessionOut],
    summary="更新对话",
)
async def update_session(
    session_id: uuid.UUID,
    payload: ChatSessionUpdateIn,
    session: SessionDep,
    caller: UseDep,
) -> ApiResponse[ChatSessionOut]:
    """改标题、归档或检索范围。归档只是不再默认列出，历史一条都不删。

    ⚠ 带了 `expected_version` 就按它断言，对不上回 409：两个标签页开着同一条
    会话时，无条件覆盖会让后写的那次把先写的范围悄悄顶掉。

    Args: session_id, payload, session, caller。
    """
    updated = await session_service.update_session(
        session, chat_session_id=session_id, caller=caller, payload=payload
    )
    return ok(updated, message="对话已更新")


@router.delete(
    "/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除对话",
)
async def delete_session(
    session_id: uuid.UUID, session: SessionDep, caller: UseDep
) -> Response:
    """删对话。消息与步骤跟着走。

    Args: session_id, session, caller。
    """
    await session_service.delete_session(
        session, chat_session_id=session_id, caller=caller
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
