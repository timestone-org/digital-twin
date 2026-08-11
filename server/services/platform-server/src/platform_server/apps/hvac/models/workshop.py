"""车间表：空间树的顶层，下面分若干房间。"""

from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from platform_server.apps.hvac.models.base import Base

if TYPE_CHECKING:
    from platform_server.apps.hvac.models.room import Room


class Workshop(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一个车间。车间名全场唯一，人靠它指认现场位置。"""

    __tablename__ = "hvac_workshops"

    name: Mapped[str] = mapped_column(Text, nullable=False)

    rooms: Mapped[list["Room"]] = relationship(
        back_populates="workshop", lazy="noload"
    )

    __table_args__ = (
        UniqueConstraint("name", name="uq_hvac_workshops_name"),
        CheckConstraint("length(name) > 0", name="name_nonempty"),
    )
