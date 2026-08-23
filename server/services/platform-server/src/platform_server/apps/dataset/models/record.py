"""台账行表（**超表**）：一行 = 一个时间桶 × 三类列。

原始值 / 公式结果 / 人工修正三者分列存，谁都覆盖不掉谁；口径见
docs/DATASET_DESIGN.md §4.2 与 §4.3。
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin
from platform_server.apps.dataset.models.base import Base
from platform_server.apps.dataset.protocols import RECORD_SOURCES, sql_values


class DatasetRecord(TimestampMixin, Base):
    """一行台账。

    ⚠ 复合主键 `(table_id, ts, row_id)`、无代理主键：`ts` 是分区列，Timescale
    要求它进每个唯一约束，而这个键一物三用——幂等去重 / 主查询索引 / 分区约束。
    推论是**改 `ts` 必须先删后插**，不能 UPDATE（§4.3）。
    """

    __tablename__ = "dataset_records"

    # ⚠ 不建外键指向 dataset_tables：超表上的外键拖慢每一次写入，删表时的清行
    # 由应用显式做
    table_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True
    )
    # 桶起点，也是分区列
    ts: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), primary_key=True
    )
    # 采集来源由桶身份 uuid5 派生（D2），人工与导入来源用 uuid7
    row_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True
    )
    # 原始值 `{列key: 值}`。⚠ 公式重算绝不写这一列
    values_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    # 人工修正 `{列key: {v, by, by_name, at, reason?}}`。⚠ 采集与重算绝不覆盖它
    overrides_json: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, nullable=True
    )
    computed_json: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, nullable=True
    )
    # 求值失败的列 `{列key: 错误文案}`，NULL = 全部成功
    compute_error: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, nullable=True
    )
    # 各点位汇总列的桶内样本数 `{列key: n}`。⚠ 不是装饰：2 个样本的 avg 与 3600
    # 个样本的 avg 在界面上长得一模一样（§4.3）
    samples_json: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB, nullable=True
    )
    source: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    # ⚠ 冗余存一份用户名是刻意的：账号可能被删，而这一行要一直答得出「谁录的」
    created_by_name: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        CheckConstraint(
            f"source IN ({sql_values(RECORD_SOURCES)})", name="source_known"
        ),
    )
