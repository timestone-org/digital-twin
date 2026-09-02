"""会话管理面。事务边界在这一层：crud 不提交，api 不写业务。

⚠ 本模块里 `session` 一律指数据库会话，聊天会话写全 `chat_session`。
"""

import uuid
from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.chat.crud import session_crud
from knowledge_server.apps.chat.errors import ChatSessionNotFound
from knowledge_server.apps.chat.models import (
    ChatMessage,
    ChatSession,
    ChatStep,
)
from knowledge_server.apps.chat.schemas import (
    ChatMessageOut,
    ChatSessionCreateIn,
    ChatSessionDetailOut,
    ChatSessionOut,
    ChatSessionUpdateIn,
    ChatStepOut,
)
from lib.auth import CallerContext
from lib.logging import get_logger
from lib.web import Page, PageParams

_logger = get_logger("knowledge.chat.session")


def visible_owner(caller: CallerContext) -> uuid.UUID:
    """这个人看得见谁的会话——眼下只有他自己的。

    ⚠ 保留这个函数而不是到处写 `caller.user_id`：「谁看得见谁的」这条判定
    要能在**一处**改完。散在四个查询里的话，总会漏掉一个，而漏掉的那个是
    一条越权读。

    Args: caller。
    """
    return caller.user_id


async def list_sessions(
    session: AsyncSession,
    *,
    caller: CallerContext,
    is_archived: bool | None,
    page: PageParams,
) -> Page[ChatSessionOut]:
    """分页列出调用者看得见的会话。

    Args: session, caller, is_archived（None = 不过滤）, page。
    """
    statement = session_crud.build_query(
        owner_id=visible_owner(caller), is_archived=is_archived
    )
    rows, total = await session_crud.list_page(
        session, statement=statement, offset=page.offset, limit=page.size
    )
    return Page[ChatSessionOut](
        items=[ChatSessionOut.model_validate(row) for row in rows],
        page=page.page,
        size=page.size,
        total=total,
    )


async def get_session(
    session: AsyncSession,
    *,
    chat_session_id: uuid.UUID,
    caller: CallerContext,
) -> ChatSessionDetailOut:
    """会话详情，连着全部消息与步骤。

    Args: session, chat_session_id, caller。
    """
    chat_session = await require_session(
        session, chat_session_id=chat_session_id, caller=caller
    )
    messages = await session_crud.messages_of(session, chat_session.id)
    steps = await session_crud.steps_of(
        session, [message.id for message in messages]
    )
    return _to_detail_out(
        chat_session,
        messages=[
            _to_message_out(message, steps=steps.get(message.id, ()))
            for message in messages
        ],
    )


async def create_session(
    session: AsyncSession,
    *,
    caller: CallerContext,
    payload: ChatSessionCreateIn,
) -> ChatSessionOut:
    """建会话。归属钉在调用者身上，入参里给不了别人的 id。

    Args: session, caller, payload。
    """
    chat_session = ChatSession(user_id=caller.user_id, title=payload.title)
    session_crud.add(session, chat_session)
    await session.flush()
    _logger.info(
        "kb_chat_session_created",
        "对话已创建",
        session_id=str(chat_session.id),
    )
    return ChatSessionOut.model_validate(chat_session)


async def update_session(
    session: AsyncSession,
    *,
    chat_session_id: uuid.UUID,
    caller: CallerContext,
    payload: ChatSessionUpdateIn,
) -> ChatSessionOut:
    """改标题或归档。缺省的字段不动。

    ⚠ 一个字段都没给时不推进 `row_version`：推了的话 `updated_at` 跟着走，
    一次什么都没改的 PATCH 会把这条会话顶到列表最前面。

    Args: session, chat_session_id, caller, payload。
    """
    chat_session = await require_session(
        session, chat_session_id=chat_session_id, caller=caller
    )
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return ChatSessionOut.model_validate(chat_session)
    session_crud.apply_changes(chat_session, changes)
    chat_session.row_version += 1
    await session.flush()
    _logger.info(
        "kb_chat_session_updated",
        "对话已更新",
        session_id=str(chat_session.id),
    )
    return ChatSessionOut.model_validate(chat_session)


async def delete_session(
    session: AsyncSession,
    *,
    chat_session_id: uuid.UUID,
    caller: CallerContext,
) -> None:
    """删会话。消息与步骤由外键级联跟着走，不留孤儿行。

    Args: session, chat_session_id, caller。
    """
    chat_session = await require_session(
        session, chat_session_id=chat_session_id, caller=caller
    )
    _logger.info(
        "kb_chat_session_deleted",
        "对话已删除",
        session_id=str(chat_session.id),
    )
    await session_crud.delete(session, chat_session)


async def require_session(
    session: AsyncSession,
    *,
    chat_session_id: uuid.UUID,
    caller: CallerContext,
) -> ChatSession:
    """取会话，看不见即 404。

    ⚠ 别人的会话回 404 而不是 403：403 等于逐个 id 回答「这条对话确实存在」。

    Args: session, chat_session_id, caller。
    """
    chat_session = await session_crud.get(session, chat_session_id)
    if chat_session is None or chat_session.user_id != visible_owner(caller):
        raise ChatSessionNotFound("对话不存在")
    return chat_session


def _to_message_out(
    message: ChatMessage, *, steps: Sequence[ChatStep]
) -> ChatMessageOut:
    return ChatMessageOut(
        id=message.id,
        session_id=message.session_id,
        seq=message.seq,
        role=message.role,
        content_json=message.content_json,
        usage_json=message.usage_json,
        created_at=message.created_at,
        steps=[ChatStepOut.model_validate(step) for step in steps],
    )


def _to_detail_out(
    chat_session: ChatSession, *, messages: Sequence[ChatMessageOut]
) -> ChatSessionDetailOut:
    return ChatSessionDetailOut(
        id=chat_session.id,
        user_id=chat_session.user_id,
        title=chat_session.title,
        is_archived=chat_session.is_archived,
        row_version=chat_session.row_version,
        last_error=chat_session.last_error,
        created_at=chat_session.created_at,
        updated_at=chat_session.updated_at,
        messages=list(messages),
    )
