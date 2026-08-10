"""权限码目录与两张关联表。

目录是只读面：码由种子驱动，运行时新建的码不会被任何 `require_perm`
或路由规则消费。分组五列落 DB，前端只读不再维护映射表。
"""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from auth_server.apps.auth.models.base import Base
from lib.db import TimestampMixin, UuidPrimaryKeyMixin

if TYPE_CHECKING:
    from auth_server.apps.auth.models.role import Role
    from auth_server.apps.auth.models.user import User

PERMISSION_KINDS = ("view", "manage", "operate", "admin")


class Permission(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一个权限码。`code` 是对外契约，一经发布不许改语义。"""

    __tablename__ = "auth_permissions"

    code: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    group_code: Mapped[str] = mapped_column(Text, nullable=False)
    group_label: Mapped[str] = mapped_column(Text, nullable=False)
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    # view 查看 / manage 管理 / operate 操作 / admin 高危
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    is_builtin: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )

    roles: Mapped[list["Role"]] = relationship(
        secondary="auth.auth_role_permissions",
        back_populates="permissions",
        lazy="noload",
    )
    users: Mapped[list["User"]] = relationship(
        secondary="auth.auth_user_permissions",
        back_populates="permissions",
        lazy="noload",
    )

    __table_args__ = (
        UniqueConstraint("code", name="uq_auth_permissions_code"),
        CheckConstraint("length(code) > 0", name="code_nonempty"),
        CheckConstraint(
            "kind IN ('view', 'manage', 'operate', 'admin')",
            name="kind_valid",
        ),
    )


class RolePermission(Base):
    """角色 → 权限码。"""

    __tablename__ = "auth_role_permissions"

    role_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("auth.auth_roles.id", ondelete="CASCADE"),
        primary_key=True,
    )
    permission_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("auth.auth_permissions.id", ondelete="CASCADE"),
        primary_key=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class UserPermission(Base):
    """用户直权：叠加在角色权限之上，不做减法。"""

    __tablename__ = "auth_user_permissions"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("auth.auth_users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    permission_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("auth.auth_permissions.id", ondelete="CASCADE"),
        primary_key=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
