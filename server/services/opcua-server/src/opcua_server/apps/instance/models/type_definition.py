"""自定义类型定义表：ObjectType / VariableType / DataType。

一行 = 实例地址空间里的一个自定义类型。`definition` 用 jsonb 装类型的形状
（字段、父类型引用、结构体成员），因为它按类型种类而异且不作为查询维度；
写入前由 schemas 层的 Pydantic 校验，jsonb 不是「什么都能塞」的借口。
"""

import uuid

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from opcua_server.apps.instance.models.base import Base
from opcua_server.apps.instance.models.node import IDENTIFIER_KINDS

TYPE_KINDS = ("object_type", "variable_type", "data_type")

_KIND_LITERALS = ", ".join(f"'{item}'" for item in TYPE_KINDS)
_IDENTIFIER_LITERALS = ", ".join(f"'{item}'" for item in IDENTIFIER_KINDS)


class TypeDefinition(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一个自定义类型。"""

    __tablename__ = "opcua_types"

    instance_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("opcua.opcua_instances.id", ondelete="CASCADE"),
        nullable=False,
    )
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    browse_name: Mapped[str] = mapped_column(Text, nullable=False)
    # 与节点同一套口径：由人指定、实例内唯一、永不自动改写
    identifier: Mapped[str] = mapped_column(Text, nullable=False)
    identifier_kind: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'string'")
    )
    # 父类型的标识；为空表示直接继承 OPC UA 的基类型
    super_type_identifier: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )
    definition: Mapped[dict[str, object]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "instance_id",
            "identifier",
            name="uq_opcua_types_instance_id_identifier",
        ),
        CheckConstraint("length(identifier) > 0", name="identifier_nonempty"),
        CheckConstraint("length(browse_name) > 0", name="browse_name_nonempty"),
        CheckConstraint(f"kind IN ({_KIND_LITERALS})", name="kind_valid"),
        CheckConstraint(
            f"identifier_kind IN ({_IDENTIFIER_LITERALS})",
            name="identifier_kind_valid",
        ),
        CheckConstraint(
            "identifier_kind <> 'numeric' OR identifier ~ '^[0-9]+$'",
            name="numeric_identifier_is_digits",
        ),
        Index("ix_opcua_types_instance_id", "instance_id"),
    )
