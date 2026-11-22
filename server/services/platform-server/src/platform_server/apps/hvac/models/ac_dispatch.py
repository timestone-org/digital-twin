"""HVAC 任务的持久信封、投递租约与消费记录。"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Index, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import UuidPrimaryKeyMixin
from platform_server.apps.hvac.models.base import Base


class AcDispatch(UuidPrimaryKeyMixin, Base):
    """与任务业务写入在同一事务留存的可投递记录。"""

    __tablename__ = "hvac_dispatches"

    kind: Mapped[str] = mapped_column(Text, nullable=False)
    fields: Mapped[dict[str, str]] = mapped_column(JSONB, nullable=False)
    dispatch_after: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("clock_timestamp()"),
    )
    dispatch_token: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    entry_id: Mapped[str | None] = mapped_column(Text)
    execution_token: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True)
    )
    execution_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )

    __table_args__ = (
        CheckConstraint("kind IN ('training', 'shard')", name="kind_known"),
        Index(
            "ix_hvac_dispatches_waiting",
            "dispatch_after",
            "id",
            postgresql_where=text("published_at IS NULL AND entry_id IS NULL"),
        ),
        Index(
            "ix_hvac_dispatches_completed",
            "completed_at",
            "id",
            postgresql_where=text("completed_at IS NOT NULL"),
        ),
    )
