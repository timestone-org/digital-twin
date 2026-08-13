"""地址空间节点表。

一行 = 实例地址空间里的一个节点。父子关系用自引用外键表达，根节点的
`parent_id` 为空（挂在服务器的 Objects 下）。

⚠ 两条容易搞混的事：
- `identifier` 是 NodeId 里由人指定的那一段，**永不自动改写**（不变式 3）。
  上位系统的组态硬编码着它，我们这边换一个，现场所有组态一起废。
- 命名空间索引**不在这张表里**——它由系统钉死为 2（不变式 4）。让人填等于
  把服务器内部的注册顺序号暴露成对外契约，而多实例下它未必一致。
"""

import uuid

from sqlalchemy import (
    ARRAY,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from opcua_server.apps.instance.models.base import Base

NODE_CLASSES = ("object", "variable", "property", "method")
# NodeId 的标识形态。OPC UA 还有 guid 与 opaque，一期不开。
IDENTIFIER_KINDS = ("numeric", "string")
# 一期支持的内建数据类型，与 asyncua 的 `ua.VariantType` 一一对应
DATA_TYPES = (
    "boolean",
    "sbyte",
    "byte",
    "int16",
    "uint16",
    "int32",
    "uint32",
    "int64",
    "uint64",
    "float",
    "double",
    "string",
    "datetime",
    "guid",
    "byte_string",
)

# OPC UA ValueRank：-3 标量或一维 / -2 任意 / -1 标量 / 0 一维以上 / n 固定维数
VALUE_RANK_MIN = -3
# AccessLevel 是一个字节的位掩码
ACCESS_LEVEL_MIN = 0
ACCESS_LEVEL_MAX = 255

_CLASS_LITERALS = ", ".join(f"'{item}'" for item in NODE_CLASSES)
_KIND_LITERALS = ", ".join(f"'{item}'" for item in IDENTIFIER_KINDS)
_TYPE_LITERALS = ", ".join(f"'{item}'" for item in DATA_TYPES)


class Node(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """地址空间里的一个节点。"""

    __tablename__ = "opcua_nodes"

    instance_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("opcua.opcua_instances.id", ondelete="CASCADE"),
        nullable=False,
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("opcua.opcua_nodes.id", ondelete="CASCADE"),
        nullable=True,
    )
    browse_name: Mapped[str] = mapped_column(Text, nullable=False)
    node_class: Mapped[str] = mapped_column(Text, nullable=False)
    identifier: Mapped[str] = mapped_column(Text, nullable=False)
    identifier_kind: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'string'")
    )
    # 仅 variable / property 有意义；object 与 method 留空
    data_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    value_rank: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("-1")
    )
    array_dimensions: Mapped[list[int] | None] = mapped_column(
        ARRAY(Integer), nullable=True
    )
    access_level: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("1")
    )
    # ⚠ 这是**初值**（配置），不是运行时的当前值。当前值的权威源是进程内存，
    # 不落库；重启后所有节点回到这里的取值（不变式 1、2）。
    initial_value: Mapped[dict[str, object] | None] = mapped_column(
        JSONB, nullable=True
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "instance_id",
            "identifier",
            name="uq_opcua_nodes_instance_id_identifier",
        ),
        CheckConstraint("length(identifier) > 0", name="identifier_nonempty"),
        CheckConstraint("length(browse_name) > 0", name="browse_name_nonempty"),
        CheckConstraint(
            f"node_class IN ({_CLASS_LITERALS})", name="node_class_valid"
        ),
        CheckConstraint(
            f"identifier_kind IN ({_KIND_LITERALS})",
            name="identifier_kind_valid",
        ),
        CheckConstraint(
            f"data_type IS NULL OR data_type IN ({_TYPE_LITERALS})",
            name="data_type_valid",
        ),
        CheckConstraint(
            f"value_rank >= {VALUE_RANK_MIN}", name="value_rank_in_range"
        ),
        CheckConstraint(
            f"access_level BETWEEN {ACCESS_LEVEL_MIN} AND {ACCESS_LEVEL_MAX}",
            name="access_level_in_range",
        ),
        # 数字标识必须真的是数字，否则建实例时才在 asyncua 侧炸
        CheckConstraint(
            "identifier_kind <> 'numeric' OR identifier ~ '^[0-9]+$'",
            name="numeric_identifier_is_digits",
        ),
        # 自己不能当自己的父节点
        CheckConstraint(
            "parent_id IS NULL OR parent_id <> id", name="no_self_parent"
        ),
        Index("ix_opcua_nodes_instance_id", "instance_id"),
        Index("ix_opcua_nodes_parent_id", "parent_id"),
    )
