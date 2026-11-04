"""工作流重新训练规则与待投递身份。"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin
from platform_server.apps.modeling.models.base import Base


class ModelingSchedule(TimestampMixin, Base):
    """每条工作流的一条持久定时规则。"""

    __tablename__ = "modeling_schedules"

    pipeline_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("platform.modeling_pipelines.id", ondelete="CASCADE"),
        primary_key=True,
    )
    is_enabled: Mapped[bool] = mapped_column(Boolean)
    interval_minutes: Mapped[int] = mapped_column(Integer)
    auto_publish: Mapped[bool] = mapped_column(Boolean)
    next_run_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    last_run_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )
    last_run_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("platform.modeling_runs.id", ondelete="SET NULL"),
        index=True,
    )
    last_error: Mapped[str | None] = mapped_column(Text)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    actor_id: Mapped[str] = mapped_column(Text)
    actor_name: Mapped[str] = mapped_column(Text)

    __table_args__ = (
        Index(
            "ix_modeling_schedules_next_run_at",
            "next_run_at",
            "pipeline_id",
            postgresql_where=text("is_enabled"),
        ),
        CheckConstraint(
            "interval_minutes BETWEEN 5 AND 525600", name="interval_valid"
        ),
        CheckConstraint("revision > 0", name="revision_positive"),
        CheckConstraint(
            "NOT is_enabled OR next_run_at IS NOT NULL", name="enabled_has_due"
        ),
    )
