"""实例凭据表：上位机连 opc.tcp 时用的 UserName 账号。

⚠ 这个账号池与 auth-server 的人类用户**完全分离**（CONTEXT §7）：上位机的
机器账号不该能登录 Web，人类用户也不该把自己的登录口令填进某台 SCADA 的
连接配置里。两边混成一个池之后，吊销一台上位机就会顺手废掉一个人。

库里只有散列（复用 `lib.auth.PasswordHasher` 的 argon2id）。明文只在创建时
返回一次，此后无从取回——丢了只能重置。
"""

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
from opcua_server.apps.instance.models.base import Base


class Credential(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一个实例内的上位机账号。"""

    __tablename__ = "opcua_instance_credentials"

    instance_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("opcua.opcua_instances.id", ondelete="CASCADE"),
        nullable=False,
    )
    username: Mapped[str] = mapped_column(Text, nullable=False)
    hashed_password: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "instance_id",
            "username",
            name="uq_opcua_instance_credentials_instance_id_username",
        ),
        CheckConstraint("length(username) > 0", name="username_nonempty"),
        CheckConstraint(
            "length(hashed_password) > 0", name="hashed_password_nonempty"
        ),
        Index("ix_opcua_instance_credentials_instance_id", "instance_id"),
    )
