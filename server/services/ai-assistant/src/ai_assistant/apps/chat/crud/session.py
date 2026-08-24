"""会话、消息与步骤的数据访问。只读写，不提交。

⚠ 本模块里 `session` 一律指数据库会话，聊天会话写全 `chat_session`：本服务的
通用语言里「会话」指的是后者，两个词撞在一处时读代码的人会看反。
"""

import uuid
from collections.abc import Sequence

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from ai_assistant.apps.chat.models import ChatMessage, ChatSession, ChatStep
from lib.db import CrudBase

# ⚠ 末位必须是唯一列：只按 `updated_at` 排的话，同一毫秒更新的两行在两次翻页
# 之间可以换位置，于是分页会静默重复某一行、同时漏掉另一行
DEFAULT_ORDER = (ChatSession.updated_at.desc(), ChatSession.id.asc())


class SessionCrud(CrudBase[ChatSession]):
    """`chat_sessions` 与它下挂的消息、步骤的数据访问。"""

    def __init__(self) -> None:
        super().__init__(ChatSession)

    @staticmethod
    def build_query(
        *,
        owner_id: uuid.UUID | None,
        surface_kind: str | None,
        is_archived: bool | None,
    ) -> Select[tuple[ChatSession]]:
        """按归属与两个过滤条件构造列表查询。

        `owner_id` 为 None 表示不限归属——只有持 `assistant:manage` 的调用者
        走得到这里，判定在 service 层。
        Args: owner_id, surface_kind, is_archived。
        """
        statement = select(ChatSession)
        if owner_id is not None:
            statement = statement.where(ChatSession.user_id == owner_id)
        if surface_kind is not None:
            statement = statement.where(
                ChatSession.surface_kind == surface_kind
            )
        if is_archived is not None:
            statement = statement.where(ChatSession.is_archived == is_archived)
        return statement.order_by(*DEFAULT_ORDER)

    async def messages_of(
        self, session: AsyncSession, chat_session_id: uuid.UUID
    ) -> list[ChatMessage]:
        """一次对话的全部消息，按会话内序号升序。

        Args: session, chat_session_id。
        """
        rows = await session.execute(
            select(ChatMessage)
            .where(ChatMessage.session_id == chat_session_id)
            .order_by(ChatMessage.seq.asc())
        )
        return list(rows.scalars().all())

    async def steps_of(
        self, session: AsyncSession, message_ids: Sequence[uuid.UUID]
    ) -> dict[uuid.UUID, list[ChatStep]]:
        """按消息批量取步骤，避免详情页 N+1。

        Args: session, message_ids。
        """
        if not message_ids:
            return {}
        rows = await session.execute(
            select(ChatStep)
            .where(ChatStep.message_id.in_(message_ids))
            .order_by(ChatStep.message_id.asc(), ChatStep.seq.asc())
        )
        grouped: dict[uuid.UUID, list[ChatStep]] = {}
        for step in rows.scalars().all():
            grouped.setdefault(step.message_id, []).append(step)
        return grouped


session_crud = SessionCrud()
