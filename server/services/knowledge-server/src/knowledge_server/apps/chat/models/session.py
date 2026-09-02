"""会话表：一次对知识库的多轮提问，属于一个用户。

⚠ 与助手那张会话表**各存各的**（ADR-0037 决策二）：跨 schema 外键是禁令，
共表则把两个服务的发布周期绑死。
⚠ 没有 `base_id`：对话是跨库的（决策三），模型自己决定去哪个库找。
"""

import uuid
from typing import Any

from sqlalchemy import Boolean, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from knowledge_server.orm import Base
from lib.db import TimestampMixin, UuidPrimaryKeyMixin

TITLE_MAX_LENGTH = 200


class ChatSession(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一次对话。归档只是不再列出，历史一条都不删。"""

    __tablename__ = "kb_chat_sessions"

    # ⚠ 不建外键指向 auth 的用户表：跨 schema 外键是三条禁令之一（ADR-0003）
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )
    # 标题由首轮对话摘要出来；摘不出时留空由界面显示时刻
    title: Mapped[str] = mapped_column(
        String(TITLE_MAX_LENGTH), nullable=False, server_default=text("''")
    )
    is_archived: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    # 乐观锁行版本。改标题与归档都推进它，前端据它判断自己手上那份旧没旧
    row_version: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("1")
    )
    # 最近一次失败的原因，给人看。⚠ 不带上游 URL 与密钥
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 窗口外那一截折成的摘要（`llmcore.memory.summarize`）。⚠ 落库不重算：
    # 同一个台阶内必须逐字复用，否则它就是历史区前面一个每轮都变的前缀断点
    summary_json: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, nullable=True
    )

    __table_args__ = (
        # 列表按归属过滤、按更新时刻排；两列一起才走得了索引。
        # ⚠ 与迁移里那条同名：模型上不写，autogenerate 会把它判成该删的多余索引
        Index("ix_kb_chat_sessions_user_updated", "user_id", "updated_at"),
    )
