"""大屏表：一张画布，有设计坐标系尺寸与一棵节点树。"""

import uuid
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from platform_server.apps.dashboard.models.base import EMPTY_JSON, Base

DEFAULT_DESIGN_WIDTH = 1920
DEFAULT_DESIGN_HEIGHT = 1080
# 文档格式版本的起点，坐标迁移按它判断而不是靠结构启发式（ADR-0012 六）
INITIAL_SCHEMA_VERSION = 1
INITIAL_ROW_VERSION = 1


class Dashboard(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一张大屏。

    ⚠ `row_version`（行版本，乐观锁用）与 `schema_version`（文档格式版本）是
    两个字段，合并它们会让一次并发写被当成一次格式升级。
    """

    __tablename__ = "dashboards"

    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.dashboard_projects.id"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    design_width: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=DEFAULT_DESIGN_WIDTH,
        server_default=text(str(DEFAULT_DESIGN_WIDTH)),
    )
    design_height: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=DEFAULT_DESIGN_HEIGHT,
        server_default=text(str(DEFAULT_DESIGN_HEIGHT)),
    )
    theme_json: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=EMPTY_JSON
    )
    chrome_json: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=EMPTY_JSON
    )
    row_version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=INITIAL_ROW_VERSION,
        server_default=text(str(INITIAL_ROW_VERSION)),
    )
    schema_version: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=INITIAL_SCHEMA_VERSION,
        server_default=text(str(INITIAL_SCHEMA_VERSION)),
    )
    is_public: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=text("false")
    )
    public_token: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("public_token", name="uq_dashboards_public_token"),
        CheckConstraint("length(name) > 0", name="name_nonempty"),
        CheckConstraint(
            "design_width > 0 AND design_height > 0",
            name="design_size_positive",
        ),
        CheckConstraint("row_version >= 1", name="row_version_positive"),
        CheckConstraint("schema_version >= 1", name="schema_version_positive"),
        # 公开的屏必须有令牌，否则「已公开」这个状态没有可用的入口
        CheckConstraint(
            "NOT is_public OR public_token IS NOT NULL",
            name="public_has_token",
        ),
        Index("ix_dashboards_project_id", "project_id"),
    )
