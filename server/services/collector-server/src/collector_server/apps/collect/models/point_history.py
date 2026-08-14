"""点位历史宽表：collector 写、platform 只读（ADR-0003）。列契约在 domain。

超表本身的分块与压缩由迁移建立，取值的实测理由见 docs/COLLECT_DESIGN.md §6。
"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Double, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from collector_server.apps.collect.models.base import Base
from timeseries import HISTORY_TABLE, QUALITIES

_QUALITY_LITERALS = ", ".join(f"'{quality}'" for quality in QUALITIES)


class PointHistory(Base):
    """一行 = 一个点位在一个时刻的读数。

    ⚠ 主键是自然复合键，不是本仓默认的 `id UUID`：Timescale 要求分区列进每个
    唯一约束，而这个键一物三用——幂等去重 / 主查询索引 / 分区约束。没有它，
    「20 个点位取最近 300 点」实测 63042ms，有它 0.62ms（见 §6）。
    ⚠ 没有 `created_at` / `updated_at`：历史行只写一次，多两列 timestamptz 是
    十亿行量级上白付的空间。
    ⚠ 无外键指向 platform 的数据源表：历史必须能在数据源删掉之后存活。
    """

    __tablename__ = HISTORY_TABLE

    source_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True
    )
    # ⚠ 存的是 point_code 这个**身份**，不是协议寻址串：换协议只改 address，
    # 历史曲线因此是连续的一条（COLLECT_DESIGN.md §2）
    point_code: Mapped[str] = mapped_column(Text, primary_key=True)
    # 分区列。⚠ 一律 timestamptz 存 UTC：本地时落库即失去口径
    ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), primary_key=True
    )
    value_num: Mapped[float | None] = mapped_column(Double, nullable=True)
    value_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    quality: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'good'")
    )

    __table_args__ = (
        CheckConstraint(f"quality IN ({_QUALITY_LITERALS})", name="quality"),
    )
