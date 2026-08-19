"""点位表：数据源下的一个测点。

⚠ `code` 是**身份**、`address` 是**配置**：换协议只改 address，历史曲线连着
（docs/COLLECT_DESIGN.md §2）。故本表不提供改 `code` 的路径。
"""

import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Float,
    ForeignKeyConstraint,
    Index,
    Integer,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from collectwire import DATA_TYPES
from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from platform_server.apps.collect.models.base import Base
from platform_server.apps.collect.models.source import MIN_INTERVAL_MS
from platform_server.apps.collect.protocols import sql_values


class CollectPoint(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一个点位。`(source_id, code)` 唯一，两者拼出全系统的 `node_key`。"""

    __tablename__ = "collect_points"

    source_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )
    code: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    address: Mapped[str] = mapped_column(Text, nullable=False)
    data_type: Mapped[str] = mapped_column(Text, nullable=False)
    unit: Mapped[str | None] = mapped_column(Text, nullable=True)
    sampling_interval_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    # 死区：变化小于它就不进归档。0 表示每次变化都收
    deadband: Mapped[float] = mapped_column(Float, nullable=False)
    archive_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)
    # 心跳：这么久没写过就强制落一条，曲线才不会在稳态段断掉
    archive_max_interval_ms: Mapped[int] = mapped_column(
        Integer, nullable=False
    )
    # 按点位的保留期，由 worker 夜间批处理执行；迁移里禁止回填
    archive_retention_days: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )

    __table_args__ = (
        ForeignKeyConstraint(
            ["source_id"],
            ["platform.collect_sources.id"],
            name="fk_collect_points_source_id",
            ondelete="CASCADE",
        ),
        UniqueConstraint("source_id", "code"),
        Index("ix_collect_points_source_id", "source_id"),
        CheckConstraint(
            f"data_type IN ({sql_values(DATA_TYPES)})", name="data_type_known"
        ),
        CheckConstraint("length(name) > 0", name="name_nonempty"),
        CheckConstraint("length(address) > 0", name="address_nonempty"),
        CheckConstraint("length(code) BETWEEN 1 AND 64", name="code_sized"),
        CheckConstraint(
            f"sampling_interval_ms >= {MIN_INTERVAL_MS}",
            name="sampling_interval_sane",
        ),
        CheckConstraint("deadband >= 0", name="deadband_nonnegative"),
        CheckConstraint(
            "archive_max_interval_ms > 0", name="archive_interval_positive"
        ),
        CheckConstraint(
            "archive_retention_days IS NULL OR archive_retention_days > 0",
            name="retention_positive",
        ),
    )
