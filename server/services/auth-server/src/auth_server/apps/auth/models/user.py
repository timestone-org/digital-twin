"""用户表。口令只存 argon2id 散列，永不存明文也永不出库。"""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from auth_server.apps.auth.models.base import Base
from lib.db import TimestampMixin, UuidPrimaryKeyMixin

if TYPE_CHECKING:
    from auth_server.apps.auth.models.permission import Permission
    from auth_server.apps.auth.models.role import Role


class User(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一个账号。"""

    __tablename__ = "auth_users"

    username: Mapped[str] = mapped_column(Text, nullable=False)
    email: Mapped[str] = mapped_column(Text, nullable=False)
    hashed_password: Mapped[str] = mapped_column(Text, nullable=False)
    full_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    phone: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    role_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        # RESTRICT：角色上还挂着人时不许删，改派后才能删
        ForeignKey("auth.auth_roles.id", ondelete="RESTRICT"),
        nullable=False,
    )

    role: Mapped["Role"] = relationship(back_populates="users", lazy="noload")
    permissions: Mapped[list["Permission"]] = relationship(
        secondary="auth.auth_user_permissions",
        back_populates="users",
        lazy="noload",
    )

    __table_args__ = (
        # 大小写不敏感唯一：`Admin` 与 `admin` 是同一个人
        Index(
            "uq_auth_users_username_lower",
            func.lower(username),
            unique=True,
        ),
        Index("uq_auth_users_email_lower", func.lower(email), unique=True),
        Index("ix_auth_users_role_id", role_id),
        CheckConstraint("length(username) > 0", name="username_nonempty"),
        CheckConstraint("position('@' in email) > 1", name="email_shape"),
    )
