"""模板、定时规则、生成任务与同事务审计。"""

import uuid
from datetime import datetime
from typing import ClassVar

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from platform_server.apps.report.models.base import Base

_JSON = JSON().with_variant(JSONB(), "postgresql")


class EagerDefaultsMixin:
    """flush 后立即读取服务端默认值。"""

    __mapper_args__: ClassVar[dict[str, object]] = {"eager_defaults": True}


class ReportTemplate(
    EagerDefaultsMixin, UuidPrimaryKeyMixin, TimestampMixin, Base
):
    """带乐观版本的报告模板。"""

    __tablename__ = "report_templates"

    code: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    granularity: Mapped[str] = mapped_column(Text, nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)
    row_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    body_json: Mapped[dict[str, object]] = mapped_column(_JSON, nullable=False)


class ReportSchedule(
    EagerDefaultsMixin, UuidPrimaryKeyMixin, TimestampMixin, Base
):
    """周期触发规则。"""

    __tablename__ = "report_schedules"

    template_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("platform.report_templates.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    granularity: Mapped[str] = mapped_column(Text, nullable=False)
    delay_hours: Mapped[int] = mapped_column(Integer, nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)
    row_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    last_run_period: Mapped[str | None] = mapped_column(Text)


class ReportRender(
    EagerDefaultsMixin, UuidPrimaryKeyMixin, TimestampMixin, Base
):
    """不可变模板快照上的一次任务。"""

    __tablename__ = "report_renders"
    __table_args__ = (
        UniqueConstraint(
            "schedule_id", "period", name="uq_report_renders_schedule_period"
        ),
        UniqueConstraint("request_key", name="uq_report_renders_request_key"),
    )

    template_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("platform.report_templates.id", ondelete="RESTRICT"),
        index=True,
    )
    schedule_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("platform.report_schedules.id", ondelete="RESTRICT"),
        index=True,
    )
    period: Mapped[str] = mapped_column(Text, nullable=False)
    granularity: Mapped[str] = mapped_column(Text, nullable=False)
    timezone: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False, default="render")
    status: Mapped[str] = mapped_column(
        Text, nullable=False, default="pending", index=True
    )
    snapshot_json: Mapped[dict[str, object]] = mapped_column(
        _JSON, nullable=False
    )
    result_json: Mapped[dict[str, object] | None] = mapped_column(_JSON)
    warnings_json: Mapped[list[str]] = mapped_column(
        _JSON, nullable=False, default=list[str]
    )
    object_key: Mapped[str | None] = mapped_column(Text)
    request_key: Mapped[str | None] = mapped_column(Text)
    request_hash: Mapped[str | None] = mapped_column(Text)
    traceparent: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[str] = mapped_column(Text, nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )


class ReportAudit(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """报告变更、生成与导出的审计记录。"""

    __tablename__ = "report_audits"

    actor_id: Mapped[str] = mapped_column(Text, nullable=False)
    action: Mapped[str] = mapped_column(Text, nullable=False)
    target_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True)
    trace_id: Mapped[str] = mapped_column(Text, nullable=False)
    before_json: Mapped[dict[str, object] | None] = mapped_column(_JSON)
    after_json: Mapped[dict[str, object] | None] = mapped_column(_JSON)
