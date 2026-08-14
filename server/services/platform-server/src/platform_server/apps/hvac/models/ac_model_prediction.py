"""折外预测表：每条可用事件「模型没见过它」的那次预测与实际的对比。"""

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import UuidPrimaryKeyMixin
from platform_server.apps.hvac.models.base import Base


class AcModelPrediction(UuidPrimaryKeyMixin, Base):
    """一条折外预测。派生数据：重训在同一事务里整体换掉，不打时间戳。"""

    __tablename__ = "hvac_ac_model_predictions"

    model_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.hvac_ac_models.id", ondelete="CASCADE"),
        nullable=False,
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    # 空调 serial 升序，与事件表同口径
    running_set: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False)
    actual_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    p10: Mapped[float] = mapped_column(Float, nullable=False)
    p50: Mapped[float] = mapped_column(Float, nullable=False)
    p90: Mapped[float] = mapped_column(Float, nullable=False)
    fold: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "model_id",
            "started_at",
            name="uq_hvac_ac_model_predictions_model_id_started_at",
        ),
        # 训练出口已排序压非负；库里再守一道，坏一行就坏一页对比
        CheckConstraint(
            "p10 >= 0 AND p10 <= p50 AND p50 <= p90",
            name="quantiles_ordered",
        ),
        CheckConstraint("actual_minutes >= 0", name="actual_nonnegative"),
        CheckConstraint("fold >= 0", name="fold_nonnegative"),
        # model_id 的外键索引由唯一约束以前缀列兼任；逐条对比页也按它取数
    )
