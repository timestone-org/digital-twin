"""会话、消息与步骤的数据访问。只读写，不提交。

⚠ 本模块里 `session` 一律指数据库会话，聊天会话写全 `chat_session`：两个词
撞在一处时读代码的人会看反。
"""

import uuid
from collections.abc import Sequence

from sqlalchemy import Select, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.chat.models import (
    ChatMessage,
    ChatSession,
    ChatStep,
)
from lib.db import CrudBase

# ⚠ 末位必须是唯一列：只按 `updated_at` 排的话，同一毫秒更新的两行在两次翻页
# 之间可以换位置，于是分页会静默重复某一行、同时漏掉另一行
DEFAULT_ORDER = (ChatSession.updated_at.desc(), ChatSession.id.asc())


class SessionCrud(CrudBase[ChatSession]):
    """`kb_chat_sessions` 与它下挂的消息、步骤的数据访问。"""

    def __init__(self) -> None:
        super().__init__(ChatSession)

    @staticmethod
    def build_query(
        *, owner_id: uuid.UUID, is_archived: bool | None
    ) -> Select[tuple[ChatSession]]:
        """按归属与归档状态构造列表查询。

        Args: owner_id, is_archived（None = 不过滤）。
        """
        has_messages = (
            select(ChatMessage.id)
            .where(ChatMessage.session_id == ChatSession.id)
            .exists()
        )
        statement = select(ChatSession).where(
            ChatSession.user_id == owner_id, has_messages
        )
        if is_archived is not None:
            statement = statement.where(ChatSession.is_archived == is_archived)
        return statement.order_by(*DEFAULT_ORDER)

    async def lock_session(
        self, session: AsyncSession, chat_session_id: uuid.UUID
    ) -> None:
        """同一对话的消息序号分配串行化；不跨外部 IO 持锁。

        Args: session, chat_session_id。
        """
        await session.execute(
            select(ChatSession.id)
            .where(ChatSession.id == chat_session_id)
            .with_for_update()
        )

    async def touch_session(
        self, session: AsyncSession, chat_session_id: uuid.UUID
    ) -> None:
        """有了新的一轮：把会话顶到列表最前、清掉上一次的失败原因，版本号不动。

        ⚠ 不动 `row_version`：它守的是范围与标题的并发改写，跟着每一轮涨的话，
        前端手里那份版本号下一次改范围必然撞 409。

        Args: session, chat_session_id。
        """
        await session.execute(
            update(ChatSession)
            .where(ChatSession.id == chat_session_id)
            .values(updated_at=func.now(), last_error=None)
        )

    async def record_error(
        self, session: AsyncSession, chat_session_id: uuid.UUID, reason: str
    ) -> None:
        """记下这次对话最近一次回合失败的原因；下一轮成功落库时清掉。

        Args: session, chat_session_id, reason（给人看的一句，不带上游细节）。
        """
        await session.execute(
            update(ChatSession)
            .where(ChatSession.id == chat_session_id)
            .values(last_error=reason)
        )

    async def max_seq(
        self, session: AsyncSession, chat_session_id: uuid.UUID
    ) -> int:
        """这次对话里最大的消息序号；还没有消息时是 0。

        Args: session, chat_session_id。
        """
        found = await session.execute(
            select(func.coalesce(func.max(ChatMessage.seq), 0)).where(
                ChatMessage.session_id == chat_session_id
            )
        )
        return int(found.scalar_one())

    async def last_message_id(
        self, session: AsyncSession, chat_session_id: uuid.UUID
    ) -> uuid.UUID | None:
        """这次对话最后一条消息的 id；还没有消息时是 `None`。

        Args: session, chat_session_id。
        """
        found = await session.execute(
            select(ChatMessage.id)
            .where(ChatMessage.session_id == chat_session_id)
            .order_by(ChatMessage.seq.desc())
            .limit(1)
        )
        return found.scalar_one_or_none()

    async def settle_waiting(
        self, session: AsyncSession, chat_session_id: uuid.UUID, state: str
    ) -> None:
        """回执到了：把这次对话里停着等浏览器的那一步结算成终态。

        Args: session, chat_session_id, state（succeeded / failed）。
        """
        await session.execute(
            update(ChatStep)
            .where(
                ChatStep.state == "awaiting_client",
                ChatStep.message_id.in_(
                    select(ChatMessage.id).where(
                        ChatMessage.session_id == chat_session_id
                    )
                ),
            )
            .values(state=state)
        )

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
