"""空调数据访问。"""

import uuid

from sqlalchemy import Select, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from platform_server.apps.hvac.models import AcUnit, Room
from platform_server.apps.hvac.schemas import AcUnitFilters

SORTABLE = {
    "serial": AcUnit.serial,
    "name": AcUnit.name,
    "created_at": AcUnit.created_at,
}
DEFAULT_ORDER = (AcUnit.serial.asc(),)


class AcUnitCrud(CrudBase[AcUnit]):
    """`hvac_ac_units` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(AcUnit)

    async def list_by_ids(
        self, session: AsyncSession, ac_unit_ids: frozenset[uuid.UUID]
    ) -> list[AcUnit]:
        """一次取回一批空调。批量改派用它，不逐个 get。

        Args: session, ac_unit_ids。
        """
        if not ac_unit_ids:
            return []
        result = await session.execute(
            select(AcUnit).where(AcUnit.id.in_(ac_unit_ids))
        )
        return list(result.scalars().all())

    async def count_by_room(
        self, session: AsyncSession, room_id: uuid.UUID
    ) -> int:
        """某个房间里的空调台数。删房间前的守卫用它。

        Args: session, room_id。
        """
        result = await session.execute(
            select(func.count())
            .select_from(AcUnit)
            .where(AcUnit.room_id == room_id)
        )
        return int(result.scalar_one())

    @staticmethod
    def build_query(filters: AcUnitFilters) -> Select[tuple[AcUnit]]:
        """按关键字与所属位置构造列表查询。

        Args: filters。
        """
        statement = select(AcUnit)
        if filters.workshop_id is not None:
            statement = statement.join(Room, Room.id == AcUnit.room_id).where(
                Room.workshop_id == filters.workshop_id
            )
        if filters.room_id is not None:
            statement = statement.where(AcUnit.room_id == filters.room_id)
        if filters.keyword:
            pattern = f"%{filters.keyword.lower()}%"
            statement = statement.where(
                or_(
                    func.lower(AcUnit.serial).like(pattern),
                    func.lower(AcUnit.name).like(pattern),
                )
            )
        return statement


ac_unit_crud = AcUnitCrud()
