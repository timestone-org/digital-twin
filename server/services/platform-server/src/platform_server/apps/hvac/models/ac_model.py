"""模型表：一个房间的达标时长预测器（配置 + 最近一次训练的产物）。"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
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
from platform_server.apps.hvac.model_statuses import (
    MODEL_STATUS_QUEUED,
    MODEL_STATUSES,
)
from platform_server.apps.hvac.models.base import Base
from platform_server.apps.hvac.startups import sql_values

_STATUS_VALUES = sql_values(MODEL_STATUSES)


class AcModel(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一个房间的达标时长模型。

    ⚠ 训练出处（`batch_fingerprint` 等）是**快照不是外键**：批次每房间只留
    3 个，外键会让老模型跟着清理消失或挡住清理（docs/AC_MODEL_DESIGN.md §3.1）。

    ⚠ 重训失败保留上一份工件与评估，只标 `failed` + 原因——坏一次训练不该把
    能用的模型变成不能用的。所以 `failed` 行上的 `metrics` 可能仍是上一次
    成功的产物。
    """

    __tablename__ = "hvac_ac_models"

    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.hvac_rooms.id"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 服务组合：组合列表，每个组合是 serial 升序数组。选的是服务面不是训练集
    serving_sets: Mapped[list[list[str]]] = mapped_column(JSONB, nullable=False)
    half_life_days: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default=MODEL_STATUS_QUEUED,
        server_default=text(f"'{MODEL_STATUS_QUEUED}'"),
    )
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    feature_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    trained_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # ---- 训练出处快照：这份模型是用哪份数据训的 ----
    batch_fingerprint: Mapped[str | None] = mapped_column(Text, nullable=True)
    batch_logic_version: Mapped[int | None] = mapped_column(
        Integer, nullable=True
    )
    window_start: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    window_end: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    sample_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 折外评估：{"overall": {...}, "by_set": {"K11+K12": {...} | null}}
    metrics: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    created_by: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "room_id", "name", name="uq_hvac_ac_models_room_id_name"
        ),
        CheckConstraint(f"status IN ({_STATUS_VALUES})", name="status_known"),
        CheckConstraint("half_life_days > 0", name="half_life_positive"),
        # 失败必须留人话原因，不许静默失败
        CheckConstraint(
            "status <> 'failed' OR error IS NOT NULL", name="failed_has_error"
        ),
        # ready 必然训练过；反过来不成立（failed 行可能带着上一次的产物）
        CheckConstraint(
            "status <> 'ready' OR "
            "(trained_at IS NOT NULL AND metrics IS NOT NULL)",
            name="ready_is_trained",
        ),
        CheckConstraint(
            "sample_count IS NULL OR sample_count >= 0",
            name="sample_count_nonnegative",
        ),
        # room_id 的外键索引由唯一约束以前缀列兼任，不再另建
        Index("ix_hvac_ac_models_status", "status"),
    )
