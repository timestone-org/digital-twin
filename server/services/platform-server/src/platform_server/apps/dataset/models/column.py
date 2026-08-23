"""列定义表：一张台账的一列，按 `source` 分成点位汇总 / 人工录入 / 公式三类。

⚠ `key` 建后不可改：它既是公式里的 `{key}`，也是 `values_json` 的字段名，
历史行全都按它存着（docs/DATASET_DESIGN.md §4.2）。
"""

import uuid
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKeyConstraint,
    Index,
    Integer,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from platform_server.apps.dataset.models.base import Base
from platform_server.apps.dataset.protocols import (
    AGG_FUNCS,
    COLUMN_SOURCES,
    COLUMN_TYPES,
    sql_values,
)

# 公式原文的长度上限
MAX_FORMULA_LENGTH = 2_000
# 展示小数位的上界。double 只有 15~17 位有效数字，再多位就是编出来的
MAX_DECIMALS = 10
# key 里放行中文，但禁掉公式语法里的全部记号：空格、单双引号、冒号、逗号、点号、
# 小括号、花括号、方括号与 `@`。
# ⚠ 花括号尤其不能漏：引用写作 `{key}`，混进一个花括号就**永远引用不到这一列**，
# 而那一列在配置界面上看起来完全正常（docs/DATASET_DESIGN.md §4.2）
# ⚠ `@` 是库公式的调用前缀：不禁掉的话，一个叫 `a@b` 的列能被建出来，而
# `{a@b} + 1` 在宏替换之后剩一个裸 `@`，报的是「调用库公式要带括号」——
# 指向一个用户根本没写的东西
KEY_PATTERN = "^[^\\s@'\"(),.:{}\\[\\]]+$"
# ⚠ 同一条规则写两遍：SQL 字面量里的单引号要写成两个，两边分叉的表现是入参
# 放行而数据库拒绝，或者反过来
_KEY_CHECK = "key ~ '^[^\\s''\"(),.:{}\\[\\]]+$'"


class DatasetColumn(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一列。`(table_id, key)` 唯一，`key` 即 JSONB 里的字段名。"""

    __tablename__ = "dataset_columns"

    table_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )
    key: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    unit: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 展示小数位，NULL = 不限
    decimals: Mapped[int | None] = mapped_column(Integer, nullable=True)
    data_type: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(Text, nullable=False)
    # 仅 source=point 有意义，八档口径见 §4.4
    agg: Mapped[str] = mapped_column(Text, nullable=False)
    # ⚠ 不建外键指向点位表：删掉一个点位不该连坐已经写出去的台账历史
    node_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    formula: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 保存公式时解析出的依赖，避免每次求值重解析
    formula_deps: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False)
    # 仅对 manual 列有意义
    is_required: Mapped[bool] = mapped_column(Boolean, nullable=False)
    # 录入表单默认值，存原值保类型
    default_value: Mapped[Any] = mapped_column(JSONB, nullable=True)

    __table_args__ = (
        ForeignKeyConstraint(
            ["table_id"],
            ["platform.dataset_tables.id"],
            name="fk_dataset_columns_table_id",
            ondelete="CASCADE",
        ),
        UniqueConstraint("table_id", "key"),
        Index("ix_dataset_columns_table_id", "table_id"),
        CheckConstraint(
            f"data_type IN ({sql_values(COLUMN_TYPES)})",
            name="data_type_known",
        ),
        CheckConstraint(
            f"source IN ({sql_values(COLUMN_SOURCES)})", name="source_known"
        ),
        CheckConstraint(f"agg IN ({sql_values(AGG_FUNCS)})", name="agg_known"),
        CheckConstraint("length(name) > 0", name="name_nonempty"),
        CheckConstraint("length(key) BETWEEN 1 AND 64", name="key_sized"),
        CheckConstraint(_KEY_CHECK, name="key_has_no_formula_token"),
        CheckConstraint(
            f"formula IS NULL OR length(formula) <= {MAX_FORMULA_LENGTH}",
            name="formula_sized",
        ),
        CheckConstraint(
            f"decimals IS NULL OR decimals BETWEEN 0 AND {MAX_DECIMALS}",
            name="decimals_sane",
        ),
    )
