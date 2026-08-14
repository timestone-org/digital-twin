"""人工排除表：把某次开机标记为不可用于训练。"""

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from platform_server.apps.hvac.models.base import Base

MAX_REASON_LENGTH = 500
MAX_EXCLUDED_BY_LENGTH = 128


class AcStartupExclusion(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一条人工排除。

    ⚠ **按自然键 `(room_id, started_at)` 挂，不挂事件行**：重算会换掉整批行，
    挂在行上的人工判断会被静默清空（docs/AC_STARTUP_DESIGN.md §4.3）。
    """

    __tablename__ = "hvac_ac_startup_exclusions"

    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.hvac_rooms.id"),
        nullable=False,
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    excluded_by: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "room_id",
            "started_at",
            name="uq_hvac_ac_startup_exclusions_room_id_started_at",
        ),
        CheckConstraint(
            f"length(reason) BETWEEN 1 AND {MAX_REASON_LENGTH}",
            name="reason_sized",
        ),
        CheckConstraint(
            f"length(excluded_by) BETWEEN 1 AND {MAX_EXCLUDED_BY_LENGTH}",
            name="excluded_by_sized",
        ),
        # room_id 的外键索引由上面的唯一约束以前缀列兼任，不再另建
    )
