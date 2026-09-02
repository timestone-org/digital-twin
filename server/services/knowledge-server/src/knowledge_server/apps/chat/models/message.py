"""消息表：一次对话里的一条发言。"""

import uuid
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from knowledge_server.apps.chat.enums import MESSAGE_ROLES, sql_values
from knowledge_server.orm import Base
from knowledge_server.settings import DB_SCHEMA
from lib.db import TimestampMixin, UuidPrimaryKeyMixin

ROLE_MAX_LENGTH = 16


class ChatMessage(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一条消息。`(session_id, seq)` 唯一，`seq` 从 1 起连续。"""

    __tablename__ = "kb_chat_messages"

    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )
    # 会话内序号。⚠ 排序靠它而不是 created_at：同一毫秒内写两条时时间戳会撞
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[str] = mapped_column(String(ROLE_MAX_LENGTH), nullable=False)
    # 消息体。形状随 role 变，本层不解析——解析归 `llmcore.memory.history`
    content_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    # 这一条花了多少 token。取不到时留空，不填 0——0 与「没拿到」是两件事
    usage_json: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, nullable=True
    )

    __table_args__ = (
        ForeignKeyConstraint(
            ["session_id"],
            [f"{DB_SCHEMA}.kb_chat_sessions.id"],
            name="fk_kb_chat_messages_session_id",
            ondelete="CASCADE",
        ),
        UniqueConstraint(
            "session_id", "seq", name="uq_kb_chat_messages_session_id_seq"
        ),
        Index("ix_kb_chat_messages_session_id", "session_id"),
        CheckConstraint(
            f"role IN ({sql_values(MESSAGE_ROLES)})", name="role_known"
        ),
        CheckConstraint("seq >= 1", name="seq_positive"),
    )
