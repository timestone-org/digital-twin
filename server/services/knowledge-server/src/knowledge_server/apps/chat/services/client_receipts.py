"""回合停下来等浏览器之后的那一头：回执对不对得上，账本怎么接回来。

⚠ 只认**最后一条消息**上那一步待续：回合续跑之后，最后一条消息换成了续跑那一轮
的，旧的待续已经结算——同一份回执再来一遍就对不上，于是重试与连点不会再跑一轮。
"""

import uuid
from collections.abc import Sequence
from typing import Any, cast

from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.chat.crud import session_crud
from knowledge_server.apps.chat.errors import ChatToolResultMismatch
from knowledge_server.apps.chat.models import ChatMessage
from knowledge_server.apps.chat.services.citations import Cited, carried_of

# 待续那一步的状态
AWAITING = "awaiting_client"


async def require_pending(
    session: AsyncSession, chat_session_id: uuid.UUID, call_ids: Sequence[str]
) -> None:
    """这几条回执都得对得上此刻待续的调用，且一条只答一次。

    Args: session, chat_session_id, call_ids（这次带回来的回执 id）。
    """
    if not call_ids:
        return
    pending = await _pending_calls(session, chat_session_id)
    if len(set(call_ids)) != len(call_ids) or not set(call_ids) <= pending:
        raise ChatToolResultMismatch(
            "工具回执 id 重复或没有对应的待续调用，请刷新这条对话后再试"
        )


async def _pending_calls(
    session: AsyncSession, chat_session_id: uuid.UUID
) -> set[str]:
    """最后一条消息上那一步待续在等哪几个调用。

    Args: session, chat_session_id。
    """
    last = await session_crud.last_message_id(session, chat_session_id)
    if last is None:
        return set()
    steps = await session_crud.steps_of(session, [last])
    found: set[str] = set()
    for step in steps.get(last, []):
        if step.state != AWAITING or step.input_json is None:
            continue
        calls = step.input_json.get("calls")
        if not isinstance(calls, list):
            continue
        for one in cast(list[Any], calls):
            if isinstance(one, dict):
                call_id = cast(dict[str, Any], one).get("call_id")
                if isinstance(call_id, str):
                    found.add(call_id)
    return found


async def carried_ledger(
    session: AsyncSession, rows: list[ChatMessage]
) -> tuple[Cited, ...]:
    """最后一条消息若停在等浏览器，取回它记下的角标账本。

    Args: session, rows（按序号升序）。
    """
    if not rows:
        return ()
    steps = await session_crud.steps_of(session, [rows[-1].id])
    waiting = [
        one for one in steps.get(rows[-1].id, []) if one.state == AWAITING
    ]
    return tuple(carried_of(waiting[-1].input_json)) if waiting else ()
