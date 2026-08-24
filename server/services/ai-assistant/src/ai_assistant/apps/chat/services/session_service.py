"""会话管理面。事务边界在这一层：crud 不提交，api 不写业务。

⚠ 本模块里 `session` 一律指数据库会话，聊天会话写全 `chat_session`——本服务的
通用语言里「会话」指的是后者。
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from ai_assistant.apps.chat.catalog import ASSISTANT_MANAGE
from ai_assistant.apps.chat.crud import session_crud
from ai_assistant.apps.chat.errors import SessionNotFound
from ai_assistant.apps.chat.models import ChatMessage, ChatSession, ChatStep
from ai_assistant.apps.chat.schemas import (
    MessageOut,
    SessionCreateIn,
    SessionDetailOut,
    SessionOut,
    SessionUpdateIn,
    StepOut,
)
from lib.auth import CallerContext
from lib.logging import get_logger
from lib.web import Page, PageParams

_logger = get_logger("assistant.chat.session")

# 持它的人看得见所有人的会话：出了事要能按一个会话 id 查到那次对话
_MANAGE_CODES = frozenset({ASSISTANT_MANAGE})


@dataclass(frozen=True)
class SessionFilters:
    """列表的两个可选过滤条件。None = 这一项不过滤。"""

    surface_kind: str | None
    is_archived: bool | None


def visible_owner(caller: CallerContext) -> uuid.UUID | None:
    """这个调用者看得见谁的会话。None = 不限归属。

    ⚠ 只有持 `assistant:manage` 的人拿得到 None：会话里存着用户与助手的完整
    对话，按 `assistant:use` 放开等于全员互相可读。
    Args: caller。
    """
    if caller.has_any(_MANAGE_CODES):
        return None
    return caller.user_id


async def list_sessions(
    session: AsyncSession,
    *,
    caller: CallerContext,
    filters: SessionFilters,
    page: PageParams,
) -> Page[SessionOut]:
    """分页列出调用者看得见的会话。

    Args: session, caller, filters, page。
    """
    statement = session_crud.build_query(
        owner_id=visible_owner(caller),
        surface_kind=filters.surface_kind,
        is_archived=filters.is_archived,
    )
    rows, total = await session_crud.list_page(
        session, statement=statement, offset=page.offset, limit=page.size
    )
    return Page[SessionOut](
        items=[SessionOut.model_validate(row) for row in rows],
        page=page.page,
        size=page.size,
        total=total,
    )


async def get_session(
    session: AsyncSession,
    *,
    chat_session_id: uuid.UUID,
    caller: CallerContext,
) -> SessionDetailOut:
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
    session: AsyncSession, *, caller: CallerContext, payload: SessionCreateIn
) -> SessionOut:
    """建会话。归属钉在调用者身上，入参里给不了别人的 id。

    Args: session, caller, payload。
    """
    chat_session = ChatSession(
        user_id=caller.user_id,
        title=payload.title,
        surface_kind=payload.surface_kind,
        surface_ref=payload.surface_ref,
    )
    session_crud.add(session, chat_session)
    await session.flush()
    _logger.info(
        "chat_session_created",
        "会话已创建",
        session_id=str(chat_session.id),
        surface_kind=chat_session.surface_kind,
    )
    return SessionOut.model_validate(chat_session)


async def update_session(
    session: AsyncSession,
    *,
    chat_session_id: uuid.UUID,
    caller: CallerContext,
    payload: SessionUpdateIn,
) -> SessionOut:
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
        return SessionOut.model_validate(chat_session)
    session_crud.apply_changes(chat_session, changes)
    chat_session.row_version += 1
    await session.flush()
    _logger.info(
        "chat_session_updated", "会话已更新", session_id=str(chat_session.id)
    )
    return SessionOut.model_validate(chat_session)


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
        "chat_session_deleted", "会话已删除", session_id=str(chat_session.id)
    )
    await session_crud.delete(session, chat_session)


async def require_session(
    session: AsyncSession,
    *,
    chat_session_id: uuid.UUID,
    caller: CallerContext,
) -> ChatSession:
    """取会话，看不见即 404。

    ⚠ 别人的会话回 404 而不是 403：403 等于逐个 id 回答「这条对话确实存在」，
    而会话 id 拿得到就能试。
    Args: session, chat_session_id, caller。
    """
    chat_session = await session_crud.get(session, chat_session_id)
    owner_id = visible_owner(caller)
    if chat_session is None or (
        owner_id is not None and chat_session.user_id != owner_id
    ):
        raise SessionNotFound("会话不存在")
    return chat_session


def _to_message_out(
    message: ChatMessage, *, steps: Sequence[ChatStep]
) -> MessageOut:
    """一条消息的对外形态。步骤由调用方按 `seq` 备好。

    Args: message, steps。
    """
    return MessageOut(
        id=message.id,
        session_id=message.session_id,
        seq=message.seq,
        role=message.role,
        content_json=message.content_json,
        usage_json=message.usage_json,
        created_at=message.created_at,
        steps=[StepOut.model_validate(step) for step in steps],
    )


def _to_detail_out(
    chat_session: ChatSession, *, messages: Sequence[MessageOut]
) -> SessionDetailOut:
    """会话详情的对外形态。

    Args: chat_session, messages。
    """
    return SessionDetailOut(
        id=chat_session.id,
        user_id=chat_session.user_id,
        title=chat_session.title,
        surface_kind=chat_session.surface_kind,
        surface_ref=chat_session.surface_ref,
        is_archived=chat_session.is_archived,
        row_version=chat_session.row_version,
        last_error=chat_session.last_error,
        created_at=chat_session.created_at,
        updated_at=chat_session.updated_at,
        messages=list(messages),
    )
