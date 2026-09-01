"""公式绑定表：把一个模型版本钉到公式库的一条条目上（§4.5、§7.4）。

⚠ 绑定表落在建模而不是给 `dataset_formulas` 加列：后者会让台账的表承载建模的
概念，等于把依赖方向掰弯，而这里存的东西只有建模侧看得懂。
"""

import uuid
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKeyConstraint,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from platform_server.apps.modeling.models.base import Base


class ModelingBinding(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一条绑定。一个公式库 code 至多绑一个模型版本。"""

    __tablename__ = "modeling_bindings"

    # `dataset_formulas.code` 的**逻辑**引用。
    # ⚠ 不建外键：跨 app 的表间外键会让本模块的 models 依赖台账的 models，
    # 而结构闸明令 models 层不跨 app（本仓先例是 `dataset_columns.node_key`）。
    # 代价是「公式条目被删、绑定成孤儿」要靠应用层守卫——列表页每次拉取时
    # 校验一遍，不做后台对账任务（§7.5、§7.7）
    fx_code: Mapped[str] = mapped_column(Text, nullable=False)
    # ⚠ RESTRICT：还有人绑着的版本删不掉，删它会让一批台账列当场算不出数
    model_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )
    # 有序的 `[{param, feature}]`。⚠ 按**位置**而不是按名字生成：调用点写的是
    # 台账列名、形参名是条目上的标签、特征名是训练时的列 key，三者可以完全
    # 不同，位置是唯一在三者之间稳定的东西（§7.4）
    param_map_json: Mapped[list[Any]] = mapped_column(JSONB, nullable=False)
    # 绑定时的形参名，provider 每次加载时比对
    param_names_snapshot: Mapped[list[Any]] = mapped_column(
        JSONB, nullable=False
    )
    is_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )
    created_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    # ⚠ 冗余存一份用户名是刻意的：账号可能被删，而这一行要一直答得出「谁绑的」
    created_by_name: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        ForeignKeyConstraint(
            ["model_version_id"],
            ["platform.modeling_model_versions.id"],
            name="fk_modeling_bindings_model_version_id",
            ondelete="RESTRICT",
        ),
        UniqueConstraint("fx_code"),
        # 与 `dataset_formulas.code` 同一条尺寸规矩：它就是调用点的字面量
        CheckConstraint(
            "length(fx_code) BETWEEN 1 AND 64", name="fx_code_sized"
        ),
        # 映射必须是数组：存成对象就丢了顺序，而实参是按位置供给的
        CheckConstraint(
            "jsonb_typeof(param_map_json) = 'array'",
            name="param_map_is_an_array",
        ),
        CheckConstraint(
            "jsonb_typeof(param_names_snapshot) = 'array'",
            name="param_names_snapshot_is_an_array",
        ),
    )
