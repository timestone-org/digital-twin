"""抽取批次表：一次抽取跑出来的一整份开机事件数据。"""

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
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from platform_server.apps.hvac.models.base import Base
from platform_server.apps.hvac.startups import BATCH_STATUSES, sql_values

_STATUS_VALUES = sql_values(BATCH_STATUSES)


class AcStartupBatch(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一次抽取的批次。

    `params_fingerprint` 与 `logic_version` 一起回答「这份数据按哪套规则算的」；
    指纹与当前规则不符时页面提醒重算（docs/AC_STARTUP_DESIGN.md §5）。
    """

    __tablename__ = "hvac_ac_startup_batches"

    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.hvac_rooms.id"),
        nullable=False,
    )
    params_fingerprint: Mapped[str] = mapped_column(Text, nullable=False)
    logic_version: Mapped[int] = mapped_column(Integer, nullable=False)
    window_start: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    window_end: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    status: Mapped[str] = mapped_column(Text, nullable=False)
    is_current: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default=text("false"),
    )
    shard_total: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    shard_done: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    episode_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )
    # ⚠ 重算后有多少条人工排除没能对上事件。参数一变某些事件的起始时刻会平移，
    # 旧键就落空了——这个数必须报出来，否则人工判断会静默地烂掉
    unmatched_exclusion_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default=text("0")
    )

    __table_args__ = (
        # 批次状态是字符串枚举 + CHECK，不用原生 ENUM——加一个取值不必改类型
        CheckConstraint(f"status IN ({_STATUS_VALUES})", name="status_known"),
        CheckConstraint("window_start < window_end", name="window_ordered"),
        CheckConstraint(
            "shard_total >= 0 AND shard_done BETWEEN 0 AND shard_total",
            name="shards_within_total",
        ),
        CheckConstraint("episode_count >= 0", name="episode_count_nonnegative"),
        CheckConstraint(
            "unmatched_exclusion_count >= 0",
            name="unmatched_exclusion_count_nonnegative",
        ),
        # ⚠ 一个房间只能有一个当前批次，由部分唯一索引在库里保证：靠代码自觉，
        # 一次并发切换就会留下两个 is_current，而页面只会挑到其中随机的一个
        Index(
            "uq_hvac_ac_startup_batches_room_id_current",
            "room_id",
            unique=True,
            postgresql_where=text("is_current"),
        ),
        # 外键列索引；批次列表也按房间过滤后取最近几条
        Index("ix_hvac_ac_startup_batches_room_id", "room_id"),
    )
