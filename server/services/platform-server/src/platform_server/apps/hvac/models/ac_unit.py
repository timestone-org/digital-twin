"""空调表：全场每一台空调一行，必定归属某个房间。"""

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
    from platform_server.apps.hvac.models.room import Room


class AcUnit(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一台空调。

    `serial` 是全场唯一的设备编号（铭牌号 / 资产号），后续接采集点位与预测
    结果都以它对齐，故唯一性由数据库约束保证而不是先查再插。
    """

    __tablename__ = "hvac_ac_units"

    room_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.hvac_rooms.id"),
        nullable=False,
    )
    serial: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)

    room: Mapped["Room"] = relationship(back_populates="units", lazy="noload")

    __table_args__ = (
        UniqueConstraint("serial", name="uq_hvac_ac_units_serial"),
        CheckConstraint("length(serial) > 0", name="serial_nonempty"),
        CheckConstraint("length(name) > 0", name="name_nonempty"),
        Index("ix_hvac_ac_units_room_id", "room_id"),
    )
