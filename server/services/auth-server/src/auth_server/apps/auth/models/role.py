"""角色表：一个用户一个角色，角色持有一组权限码。"""

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from auth_server.apps.auth.models.base import Base
from lib.db import TimestampMixin, UuidPrimaryKeyMixin

if TYPE_CHECKING:
    from auth_server.apps.auth.models.permission import Permission
    from auth_server.apps.auth.models.user import User


class Role(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一个岗位。内置角色由种子全量覆盖，不可删、名称与权限集不可改。"""

    __tablename__ = "auth_roles"

    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_builtin: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )

    users: Mapped[list["User"]] = relationship(
        back_populates="role", lazy="noload"
    )
    permissions: Mapped[list["Permission"]] = relationship(
        secondary="auth.auth_role_permissions",
        back_populates="roles",
        lazy="noload",
    )

    __table_args__ = (
        UniqueConstraint("name", name="uq_auth_roles_name"),
        CheckConstraint("length(name) > 0", name="name_nonempty"),
    )
