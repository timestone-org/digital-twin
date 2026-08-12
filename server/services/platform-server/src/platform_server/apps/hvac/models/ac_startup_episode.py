"""开机事件表：一个房间从全停到达标的一次完整过程。"""

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
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from platform_server.apps.hvac.models.base import Base
from platform_server.apps.hvac.startups import (
    OUTCOME_USABLE,
    OUTCOMES,
    sql_values,
)

_OUTCOME_VALUES = sql_values(OUTCOMES)


class AcStartupEpisode(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一次开机事件。

    ⚠ **只存事实，不存特征**：特征工程的迭代频率远高于事件定义，混在一张表里
    会让快的那个拖着慢的那个全量重算（docs/AC_STARTUP_DESIGN.md §4.2）。
    """

    __tablename__ = "hvac_ac_startup_episodes"

    batch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        # ⚠ 批次是派生数据且只保留最近三个，清理必须连同事件一起走；台账那条
        # 「删除不级联」管的是人一台台录进去的数据，不管这里
        ForeignKey("platform.hvac_ac_startup_batches.id", ondelete="CASCADE"),
        nullable=False,
    )
    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.hvac_rooms.id"),
        nullable=False,
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    # 空调 serial 升序，等值比较才稳定
    running_set: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False)
    complied_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    duration_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    outcome: Mapped[str] = mapped_column(Text, nullable=False)
    # 起始帧上每台的原始读数：serial → 指标 → 值
    readings: Mapped[dict[str, dict[str, float | None]]] = mapped_column(
        JSONB, nullable=False
    )

    __table_args__ = (
        UniqueConstraint(
            "batch_id",
            "started_at",
            name="uq_hvac_ac_startup_episodes_batch_id_started_at",
        ),
        CheckConstraint(
            f"outcome IN ({_OUTCOME_VALUES})", name="outcome_known"
        ),
        CheckConstraint(
            "cardinality(running_set) > 0", name="running_set_nonempty"
        ),
        # 达标时刻与结果必须同进同退：只有达标了才是可用样本
        CheckConstraint(
            f"(outcome = '{OUTCOME_USABLE}') = (complied_at IS NOT NULL)",
            name="compliance_matches_outcome",
        ),
        CheckConstraint(
            "(complied_at IS NULL) = (duration_minutes IS NULL)",
            name="duration_matches_compliance",
        ),
        CheckConstraint(
            "duration_minutes IS NULL OR duration_minutes >= 0",
            name="duration_nonnegative",
        ),
        # batch_id 的外键索引由上面的唯一约束以前缀列兼任，不再另建
        Index("ix_hvac_ac_startup_episodes_room_id", "room_id"),
    )
