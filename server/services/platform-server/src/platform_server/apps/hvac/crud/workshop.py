"""车间数据访问。"""

import uuid

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.db import CrudBase
from platform_server.apps.hvac.models import AcUnit, Room, Workshop

SORTABLE = {"name": Workshop.name, "created_at": Workshop.created_at}
DEFAULT_ORDER = (Workshop.name.asc(),)


class WorkshopCrud(CrudBase[Workshop]):
    """`hvac_workshops` 的数据访问。"""

    def __init__(self) -> None:
        super().__init__(Workshop)

    async def room_counts(
        self, session: AsyncSession, workshop_ids: frozenset[uuid.UUID]
    ) -> dict[uuid.UUID, int]:
        """批量取每个车间下的房间数，避免列表页 N+1。

        Args: session, workshop_ids。
        """
        if not workshop_ids:
            return {}
        rows = await session.execute(
            select(Room.workshop_id, func.count())
            .where(Room.workshop_id.in_(workshop_ids))
            .group_by(Room.workshop_id)
        )
        counts = dict.fromkeys(workshop_ids, 0)
        for workshop_id, total in rows.all():
            counts[workshop_id] = int(total)
        return counts

    async def ac_unit_counts(
        self, session: AsyncSession, workshop_ids: frozenset[uuid.UUID]
    ) -> dict[uuid.UUID, int]:
        """批量取每个车间下的空调台数。

        Args: session, workshop_ids。
        """
        if not workshop_ids:
            return {}
        rows = await session.execute(
            select(Room.workshop_id, func.count())
            .join(AcUnit, AcUnit.room_id == Room.id)
            .where(Room.workshop_id.in_(workshop_ids))
            .group_by(Room.workshop_id)
        )
        counts = dict.fromkeys(workshop_ids, 0)
        for workshop_id, total in rows.all():
            counts[workshop_id] = int(total)
        return counts

    @staticmethod
    def build_query(*, keyword: str | None) -> Select[tuple[Workshop]]:
        """按关键字构造列表查询。

        Args: keyword。
        """
        statement = select(Workshop)
        if keyword:
            pattern = f"%{keyword.lower()}%"
            statement = statement.where(func.lower(Workshop.name).like(pattern))
        return statement


workshop_crud = WorkshopCrud()
