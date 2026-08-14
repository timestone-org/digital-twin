"""数据源的采集运行态：collector 写、platform 只读（ADR-0003）。

一行 = 一个数据源此刻连没连上。⚠ 这里存的是**运行态**不是配置：配置的属主是
platform 的 `collect_sources`，两张表分属两个 schema，故意不做外键。
"""

import uuid

from sqlalchemy import CheckConstraint, Integer, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from collector_server.apps.collect.models.base import Base
from lib.db import TimestampMixin

# 与 runtime/session.py 的 STATES 逐字一致
STATES = ("connecting", "online", "offline")
# 与 drivers/base.py 的 ErrorCategory 逐字一致
ERROR_CATEGORIES = ("transient", "config", "auth")

_STATE_LITERALS = ", ".join(f"'{state}'" for state in STATES)
_CATEGORY_LITERALS = ", ".join(f"'{item}'" for item in ERROR_CATEGORIES)


class SourceState(TimestampMixin, Base):
    """一个数据源的采集运行态。"""

    __tablename__ = "collect_source_states"

    # ⚠ 主键就是 platform 那边的数据源 id，不另生成一个：一个数据源只有一行
    # 运行态，用自然键才能靠 ON CONFLICT 幂等地覆盖
    source_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True
    )
    state: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'offline'")
    )
    point_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    error_category: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 异常类型名，不是异常原文——原文可能带凭据与请求体
    error_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 哪个副本在采。单活下只有一个，出问题时要能一眼看出是谁
    leader_instance: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        CheckConstraint(f"state IN ({_STATE_LITERALS})", name="state_valid"),
        CheckConstraint(
            f"error_category IS NULL OR error_category IN "
            f"({_CATEGORY_LITERALS})",
            name="error_category_valid",
        ),
        CheckConstraint("point_count >= 0", name="point_count_not_negative"),
    )
