"""数据源绑定表：一台空调的一个数据集，读外部库里的哪个对象。"""

import uuid

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from platform_server.apps.hvac.datasets import dataset_keys
from platform_server.apps.hvac.models.base import Base

# 视图名的长度上限，与外部库标识符的实际长度留足余量
MAX_SOURCE_OBJECT_LENGTH = 128

_DATASET_VALUES = ", ".join(f"'{key}'" for key in sorted(dataset_keys()))


class AcDataBinding(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一条绑定。

    `source_object` 是外部库里的视图名。它是人填的、且**必须拼进 SQL**（标识符
    不能参数化），故写入前要过白名单正则与存在性校验，取用时再方括号引用。
    """

    __tablename__ = "hvac_ac_data_bindings"

    ac_unit_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.hvac_ac_units.id"),
        nullable=False,
    )
    dataset: Mapped[str] = mapped_column(Text, nullable=False)
    source_object: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "ac_unit_id",
            "dataset",
            name="uq_hvac_ac_data_bindings_ac_unit_id_dataset",
        ),
        # 数据集是字符串枚举 + CHECK，不用原生 ENUM——加一个取值不必改类型
        CheckConstraint(
            f"dataset IN ({_DATASET_VALUES})", name="dataset_known"
        ),
        CheckConstraint(
            f"length(source_object) BETWEEN 1 AND {MAX_SOURCE_OBJECT_LENGTH}",
            name="source_object_sized",
        ),
        Index("ix_hvac_ac_data_bindings_ac_unit_id", "ac_unit_id"),
    )
