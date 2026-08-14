"""房间表：车间内的一个封闭空间，也是空调互相影响的边界。"""

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from platform_server.apps.hvac.models.base import Base

if TYPE_CHECKING:
    from platform_server.apps.hvac.models.ac_unit import AcUnit
    from platform_server.apps.hvac.models.workshop import Workshop


class Room(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一个房间。

    ⚠ **同一房间内的空调共处一个热力空间、互相影响**，因此房间是空间配置的
    分组单位，也是后续开机预测的最小聚合单位——它不只是一个展示用的标签。
    """

    __tablename__ = "hvac_rooms"

    workshop_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.hvac_workshops.id"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)

    workshop: Mapped["Workshop"] = relationship(
        back_populates="rooms", lazy="noload"
    )
    units: Mapped[list["AcUnit"]] = relationship(
        back_populates="room", lazy="noload"
    )

    __table_args__ = (
        # 房间名只在车间内唯一：两个车间各有一间「配电房」是常态
        UniqueConstraint(
            "workshop_id", "name", name="uq_hvac_rooms_workshop_id_name"
        ),
        CheckConstraint("length(name) > 0", name="name_nonempty"),
        # 外键列必须有索引，否则删车间时会全表扫房间表
        Index("ix_hvac_rooms_workshop_id", "workshop_id"),
    )
