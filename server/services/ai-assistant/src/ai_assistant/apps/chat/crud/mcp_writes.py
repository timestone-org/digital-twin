"""MCP 确认的数据库读取；所有事务与实际派发留在服务层。"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ai_assistant.apps.chat.crud import session_crud
from ai_assistant.apps.chat.errors import SessionNotFound
from ai_assistant.apps.chat.models import ChatMessage, ChatSession, ChatStep
from lib.errors import Conflict


async def lock_owner(
    session: AsyncSession, session_id: uuid.UUID, owner_id: uuid.UUID
) -> ChatSession:
    """锁定调用者自己的会话，隐藏外人会话是否存在。

    Args: session, session_id, owner_id。"""
    await session_crud.lock_session(session, session_id)
    row = await session_crud.get(session, session_id)
    if row is None or row.user_id != owner_id:
        raise SessionNotFound("会话不存在")
    return row


async def steps_of(
    session: AsyncSession, session_id: uuid.UUID
) -> list[tuple[ChatStep, int]]:
    """取步骤及所属消息顺序。

    Args: session, session_id。"""
    statement = (
        select(ChatStep, ChatMessage.seq)
        .join(ChatMessage, ChatStep.message_id == ChatMessage.id)
        .where(ChatMessage.session_id == session_id)
    )
    return [
        (row[0], row[1]) for row in (await session.execute(statement)).all()
    ]


async def has_running(session: AsyncSession, session_id: uuid.UUID) -> bool:
    """会话锁下检查实际 MCP 写操作，防止删除执行回执载体。

    Args: session, session_id。
    """
    statement = (
        select(ChatStep.id)
        .join(ChatMessage, ChatStep.message_id == ChatMessage.id)
        .where(
            ChatMessage.session_id == session_id,
            ChatStep.kind == "client_tool",
            ChatStep.name.startswith("mcp."),
            ChatStep.state == "running",
        )
        .limit(1)
    )
    return (await session.execute(statement)).scalar_one_or_none() is not None


async def active_call(
    session: AsyncSession, session_id: uuid.UUID, call_id: str
) -> ChatStep:
    """最新用户消息之后唯一的未执行调用才可确认。

    Args: session, session_id, call_id。"""
    messages = await session_crud.messages_of(session, session_id)
    latest_user = max(
        (row.seq for row in messages if row.role == "user"), default=0
    )
    matches = [
        (step, seq)
        for step, seq in await steps_of(session, session_id)
        if step.kind == "client_tool"
        and (step.input_json or {}).get("call_id") == call_id
    ]
    if len(matches) != 1:
        raise Conflict("调用不存在或不唯一，不能确认")
    step, seq = matches[0]
    if step.state != "awaiting_client" or seq < latest_user:
        raise Conflict("调用已结束或不属于当前回合")
    return step


async def step_by_id(session: AsyncSession, step_id: uuid.UUID) -> ChatStep:
    """实际执行完成后只写回原步骤。

    Args: session, step_id。"""
    step = await session.get(ChatStep, step_id)
    if step is None:
        raise Conflict("调用已删除，无法保存回执")
    return step


async def append_receipt(
    session: AsyncSession, session_id: uuid.UUID, content: dict[str, object]
) -> None:
    """会话行锁下追加一条实际工具消息。

    Args: session, session_id, content。"""
    messages = await session_crud.messages_of(session, session_id)
    session.add(
        ChatMessage(
            session_id=session_id,
            seq=max((row.seq for row in messages), default=0) + 1,
            role="tool",
            content_json=content,
        )
    )
