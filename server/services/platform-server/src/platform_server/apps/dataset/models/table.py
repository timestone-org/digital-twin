"""台账定义表：一张台账的身份、周期与保留期。

⚠ `code` 建后不可改：它是大屏绑定键 `ds:{code}:{列key}` 的前半段，改一次等于
让每一处引用它的绑定悄悄失效（docs/DATASET_DESIGN.md §4.2）。
"""

from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from platform_server.apps.dataset.models.base import Base
from platform_server.apps.dataset.protocols import COLLECT_MODES, sql_values

# 桶宽下限：比它更密的周期一年就是千万行，超出本层的规模前提（§1.3）
MIN_INTERVAL_MS = 1_000
# ⚠ 上界 1 天是**已知限制而非设计意图**：周宽及以上的桶，PG 的 time_bucket 按
# 2000-01-03 对齐、Python 侧按 2000-01-01 对齐，差 2 天且不报错（§4.2）
MAX_INTERVAL_MS = 86_400_000


class DatasetTable(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一张台账。`code` 全局唯一，供人、Agent 与大屏绑定按名字指认。"""

    __tablename__ = "dataset_tables"

    code: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    collect_mode: Mapped[str] = mapped_column(Text, nullable=False)
    # 一行覆盖的桶宽
    collect_interval_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    # 空表示永久保留（D7）
    retention_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 采集器水位：已算完的最后一个桶的起点
    last_collected_ts: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)

    __table_args__ = (
        CheckConstraint(
            f"collect_mode IN ({sql_values(COLLECT_MODES)})",
            name="collect_mode_known",
        ),
        CheckConstraint("length(name) > 0", name="name_nonempty"),
        CheckConstraint("length(code) BETWEEN 1 AND 64", name="code_sized"),
        CheckConstraint(
            f"collect_interval_ms BETWEEN {MIN_INTERVAL_MS} "
            f"AND {MAX_INTERVAL_MS}",
            name="collect_interval_sane",
        ),
        CheckConstraint(
            "retention_days IS NULL OR retention_days > 0",
            name="retention_positive",
        ),
    )
