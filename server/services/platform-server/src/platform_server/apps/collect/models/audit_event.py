"""采集配置与写值的追加审计事件。"""

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql.elements import conv

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
    intent_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(),
        ForeignKey(
            "platform.collect_audit_events.id",
            name="fk_collect_audit_event_intent",
        ),
    )
    before_json: Mapped[dict[str, object] | None] = mapped_column(
        JSONB(none_as_null=True)
    )
    after_json: Mapped[dict[str, object] | None] = mapped_column(
        JSONB(none_as_null=True)
    )
    outcome_code: Mapped[int | None] = mapped_column(Integer)

    __table_args__ = (
        UniqueConstraint("intent_id", name="uq_collect_audit_event_intent"),
        CheckConstraint(
            "target_kind IN ('source', 'point')",
            name=conv("ck_collect_audit_target_kind"),
        ),
        CheckConstraint(
            "(event_kind IN ('created', 'updated', 'deleted') "
            "AND intent_id IS NULL) OR "
            "(target_kind = 'point' AND ("
            "(event_kind = 'write_intent' AND intent_id IS NULL) OR "
            "(event_kind IN ('write_confirmed', 'write_rejected', "
            "'write_unconfirmed') AND intent_id IS NOT NULL)))",
            name=conv("ck_collect_audit_event_kind"),
        ),
        Index(
            "ix_collect_audit_events_target",
            "target_kind",
            "target_id",
            "created_at",
            "id",
        ),
    )
