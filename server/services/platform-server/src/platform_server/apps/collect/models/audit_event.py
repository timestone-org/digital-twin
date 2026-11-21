"""采集配置与写值的追加审计事件。"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, Text, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import UuidPrimaryKeyMixin
from platform_server.apps.collect.models.base import Base


class CollectAuditEvent(UuidPrimaryKeyMixin, Base):
    __tablename__ = "collect_audit_events"

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    actor_id: Mapped[uuid.UUID] = mapped_column(Uuid(), nullable=False)
    source_ip: Mapped[str | None] = mapped_column(Text)
    trace_id: Mapped[str] = mapped_column(Text, nullable=False)
    target_kind: Mapped[str] = mapped_column(Text, nullable=False)
    target_id: Mapped[uuid.UUID] = mapped_column(Uuid(), nullable=False)
    source_id: Mapped[uuid.UUID] = mapped_column(Uuid(), nullable=False)
    event_kind: Mapped[str] = mapped_column(Text, nullable=False)
    intent_id: Mapped[uuid.UUID | None] = mapped_column(Uuid())
    before_json: Mapped[dict[str, object] | None] = mapped_column(
        JSONB(none_as_null=True)
    )
    after_json: Mapped[dict[str, object] | None] = mapped_column(
        JSONB(none_as_null=True)
    )
    outcome_code: Mapped[int | None] = mapped_column(Integer)
