"""建模模板快照、实例身份与配置审计，见 ADR-0061。"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from platform_server.apps.modeling.models.base import Base, CreatedAtMixin


class ModelingTemplate(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一版已发布的流水线快照。"""

    __tablename__ = "modeling_templates"
    pipeline_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("platform.modeling_pipelines.id", ondelete="RESTRICT"),
        index=True,
    )
    code: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    version: Mapped[int] = mapped_column(Integer)
    graph_json: Mapped[dict[str, Any]] = mapped_column(JSONB)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[str] = mapped_column(Text)
    created_by_name: Mapped[str] = mapped_column(Text)

    __table_args__ = (
        UniqueConstraint("pipeline_id", "version"),
        CheckConstraint("version > 0", name="version_positive"),
        CheckConstraint("length(name) > 0", name="name_nonempty"),
        CheckConstraint(
            "jsonb_typeof(graph_json) = 'object'", name="graph_object"
        ),
    )


class ModelingInstance(TimestampMixin, Base):
    """实例与其执行流水线共用身份；模板固定，参数独立。"""

    __tablename__ = "modeling_instances"
    id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("platform.modeling_pipelines.id", ondelete="RESTRICT"),
        primary_key=True,
    )
    template_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("platform.modeling_templates.id", ondelete="RESTRICT"),
        index=True,
    )
    revision: Mapped[int] = mapped_column(Integer, default=1)
    archived_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    __table_args__ = (
        CheckConstraint("revision > 0", name="revision_positive"),
    )


class ModelingConfigurationAudit(UuidPrimaryKeyMixin, CreatedAtMixin, Base):
    """与配置变更同事务保存的审计记录。"""

    __tablename__ = "modeling_configuration_audits"
    actor_id: Mapped[str] = mapped_column(Text)
    source_ip: Mapped[str | None] = mapped_column(Text)
    action: Mapped[str] = mapped_column(Text)
    target_id: Mapped[uuid.UUID] = mapped_column(index=True)
    trace_id: Mapped[str] = mapped_column(Text)
    before_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    after_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
