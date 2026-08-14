"""达标范围表：一台空调某个指标的上下限，后期判定是否达标的计算标准。"""

import uuid
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    Numeric,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from platform_server.apps.hvac.datasets import limitable_metric_keys
from platform_server.apps.hvac.models.base import Base

# 温湿度这类量 6 位整数 2 位小数绰绰有余；用 numeric 而非 float 是因为它是人配的
# 精确值，不是测量值
LIMIT_PRECISION = 8
LIMIT_SCALE = 2

_METRIC_VALUES = ", ".join(
    f"'{key}'" for key in sorted(limitable_metric_keys())
)


class AcMetricLimit(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一台空调某个指标的达标范围。

    ⚠ 单边为 `null` 表示**该侧不限制**，不表示 0。两端都为 null 的记录没有意义，
    由 CHECK 拦下——那种行只会让「配过」与「没配过」变得无法区分。
    """

    __tablename__ = "hvac_ac_metric_limits"

    ac_unit_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.hvac_ac_units.id"),
        nullable=False,
    )
    metric: Mapped[str] = mapped_column(Text, nullable=False)
    lower_limit: Mapped[Decimal | None] = mapped_column(
        Numeric(LIMIT_PRECISION, LIMIT_SCALE), nullable=True
    )
    upper_limit: Mapped[Decimal | None] = mapped_column(
        Numeric(LIMIT_PRECISION, LIMIT_SCALE), nullable=True
    )

    __table_args__ = (
        UniqueConstraint(
            "ac_unit_id",
            "metric",
            name="uq_hvac_ac_metric_limits_ac_unit_id_metric",
        ),
        CheckConstraint(f"metric IN ({_METRIC_VALUES})", name="metric_known"),
        CheckConstraint(
            "lower_limit IS NULL OR upper_limit IS NULL "
            "OR lower_limit <= upper_limit",
            name="bounds_ordered",
        ),
        CheckConstraint(
            "lower_limit IS NOT NULL OR upper_limit IS NOT NULL",
            name="bounds_not_both_null",
        ),
        Index("ix_hvac_ac_metric_limits_ac_unit_id", "ac_unit_id"),
    )
