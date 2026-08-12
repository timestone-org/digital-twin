"""分片表：一次抽取里「房间 + 月」这一片跑到哪一步了。"""

import uuid

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from platform_server.apps.hvac.models.base import Base
from platform_server.apps.hvac.startups import SHARD_STATUSES, sql_values

_STATUS_VALUES = sql_values(SHARD_STATUSES)
MAX_SHARD_ERROR_LENGTH = 500


class AcStartupShard(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一片的进度。

    ⚠ 进度记在行上而不是靠给批次的计数器 +1：队列是 at-least-once，同一条消息
    重放一次计数器就多加一次，进度会冲过 100% 而批次永远等不到「全部完成」。
    按 `(batch_id, month)` 唯一的行是幂等的，`shard_done` 由它数出来。
    """

    __tablename__ = "hvac_ac_startup_shards"

    batch_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.hvac_ac_startup_batches.id", ondelete="CASCADE"),
        nullable=False,
    )
    month: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    # 停在这个状态的原因（失败原因或跳过原因），只给人看；不含连接串与 SQL
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "batch_id",
            "month",
            name="uq_hvac_ac_startup_shards_batch_id_month",
        ),
        CheckConstraint(f"status IN ({_STATUS_VALUES})", name="status_known"),
        CheckConstraint("month ~ '^[0-9]{4}-[0-9]{2}$'", name="month_shaped"),
        CheckConstraint(
            f"error IS NULL OR length(error) BETWEEN 1 AND "
            f"{MAX_SHARD_ERROR_LENGTH}",
            name="error_sized",
        ),
        # batch_id 的外键索引由上面的唯一约束以前缀列兼任，不再另建
    )
