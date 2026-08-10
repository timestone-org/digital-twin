"""审计表：谁在什么时候改了什么。

⚠ 审计记录写在**业务事务内**——异步写会出现「改了但没审计」或「审计了但没改」。
这与普通日志可采样、可过期的取舍相反，因为审计的完整性比性能重要。
"""

import uuid
from typing import Any

from sqlalchemy import CheckConstraint, Index, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from auth_server.apps.auth.models.base import Base
from lib.db import TimestampMixin, UuidPrimaryKeyMixin


class AuditLog(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一条审计记录。`action` 是稳定字面量，不许拼变量。"""

    __tablename__ = "auth_audit_logs"

    # 操作者。账号被删后记录仍要留存，故不设外键
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    actor_username: Mapped[str] = mapped_column(Text, nullable=False)
    action: Mapped[str] = mapped_column(Text, nullable=False)
    target_type: Mapped[str] = mapped_column(Text, nullable=False)
    target_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    before: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    after: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    source_ip: Mapped[str | None] = mapped_column(Text, nullable=True)
    trace_id: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        CheckConstraint("length(action) > 0", name="action_nonempty"),
        Index("ix_auth_audit_logs_created_at", "created_at"),
        Index("ix_auth_audit_logs_actor_id", "actor_id"),
    )
