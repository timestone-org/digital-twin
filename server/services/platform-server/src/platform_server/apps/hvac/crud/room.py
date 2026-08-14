"""房间数据访问。"""

import uuid
from dataclasses import dataclass

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from platform_server.apps.hvac.models import AcUnit, Room, Workshop

SORTABLE = {"name": Room.name, "created_at": Room.created_at}
DEFAULT_ORDER = (Room.name.asc(),)


@dataclass(frozen=True)
class RoomLocation:
    """一个房间连同它所在车间的名字。

    列表页要显示「哪个车间的哪个房间」，逐行回查就是 N+1，故一次批量取回。
    """

    room_id: uuid.UUID
    room_name: str
    workshop_id: uuid.UUID
    workshop_name: str


class RoomCrud(CrudBase[Room]):
    """`hvac_rooms` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(Room)

    async def locations(
        self, session: AsyncSession, room_ids: frozenset[uuid.UUID]
    ) -> dict[uuid.UUID, RoomLocation]:
        """批量取一组房间的「车间 + 房间」名字。

        Args: session, room_ids。
        """
        if not room_ids:
            return {}
        rows = await session.execute(
            select(Room.id, Room.name, Workshop.id, Workshop.name)
            .join(Workshop, Workshop.id == Room.workshop_id)
            .where(Room.id.in_(room_ids))
        )
        found: dict[uuid.UUID, RoomLocation] = {}
        for room_id, room_name, workshop_id, workshop_name in rows.all():
            found[room_id] = RoomLocation(
                room_id=room_id,
                room_name=room_name,
                workshop_id=workshop_id,
                workshop_name=workshop_name,
            )
        return found

    async def ac_unit_counts(
        self, session: AsyncSession, room_ids: frozenset[uuid.UUID]
    ) -> dict[uuid.UUID, int]:
        """批量取每个房间里的空调台数。

        Args: session, room_ids。
        """
        if not room_ids:
            return {}
        rows = await session.execute(
            select(AcUnit.room_id, func.count())
            .where(AcUnit.room_id.in_(room_ids))
            .group_by(AcUnit.room_id)
        )
        counts = dict.fromkeys(room_ids, 0)
        for room_id, total in rows.all():
            counts[room_id] = int(total)
        return counts

    async def count_by_workshop(
        self, session: AsyncSession, workshop_id: uuid.UUID
    ) -> int:
        """某个车间下的房间数。删车间前的守卫用它。

        Args: session, workshop_id。
        """
        result = await session.execute(
            select(func.count())
            .select_from(Room)
            .where(Room.workshop_id == workshop_id)
        )
        return int(result.scalar_one())

    @staticmethod
    def build_query(
        *, workshop_id: uuid.UUID | None, keyword: str | None
    ) -> Select[tuple[Room]]:
        """按车间与关键字构造列表查询。

        Args: workshop_id, keyword。
        """
        statement = select(Room)
        if workshop_id is not None:
            statement = statement.where(Room.workshop_id == workshop_id)
        if keyword:
            pattern = f"%{keyword.lower()}%"
            statement = statement.where(func.lower(Room.name).like(pattern))
        return statement


room_crud = RoomCrud()
