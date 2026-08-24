"""步骤表：一个回合里的一次模型调用或一次工具执行。

⚠ 步骤单独一张表而不是塞进消息的 JSON 里，理由有三：界面要逐条渲染并可折叠，
塞在 JSON 里就得整条取回再在前端拆；续跑只需要读最后一条待续的那一步；
排障时「哪一步慢、哪一步失败」是最常问的问题，列出来才查得动。
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from ai_assistant.apps.chat.enums import STEP_KINDS, STEP_STATES, sql_values
from ai_assistant.apps.chat.models.base import Base
from lib.db import TimestampMixin, UuidPrimaryKeyMixin

KIND_MAX_LENGTH = 16
STATE_MAX_LENGTH = 16
# 工具名形如 `dashboard.set_config`，与技能清单里登记的逐字相同
NAME_MAX_LENGTH = 64


class ChatStep(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一个步骤。`(message_id, seq)` 唯一，`seq` 从 1 起连续。"""

    __tablename__ = "chat_steps"

    message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(KIND_MAX_LENGTH), nullable=False)
    # 模型步给模型名，工具步给工具名。界面上就显示它，所以不许留空
    name: Mapped[str] = mapped_column(String(NAME_MAX_LENGTH), nullable=False)
    state: Mapped[str] = mapped_column(String(STATE_MAX_LENGTH), nullable=False)
    # 工具入参 / 模型的提示摘要。⚠ 绝不写进完整提示词与密钥
    input_json: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, nullable=True
    )
    output_json: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, nullable=True
    )
    # 失败原因，给人看。与 `chat_sessions.last_error` 同口径：不带 URL 与密钥
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    # ⚠ 这两个时刻由应用写，不给 server_default：它们量的是这一步真正开始与
    # 结束的时刻，而 `created_at` 量的是行什么时候插进来的，两者在续跑的
    # 那一步上差着一整个往返
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        ForeignKeyConstraint(
            ["message_id"],
            ["assistant.chat_messages.id"],
            name="fk_chat_steps_message_id",
            ondelete="CASCADE",
        ),
        UniqueConstraint(
            "message_id", "seq", name="uq_chat_steps_message_id_seq"
        ),
        Index("ix_chat_steps_message_id", "message_id"),
        CheckConstraint(
            f"kind IN ({sql_values(STEP_KINDS)})", name="kind_known"
        ),
        CheckConstraint(
            f"state IN ({sql_values(STEP_STATES)})", name="state_known"
        ),
        CheckConstraint("seq >= 1", name="seq_positive"),
        CheckConstraint("length(name) > 0", name="name_nonempty"),
    )
