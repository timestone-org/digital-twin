"""房间配置写入的统一事务边界，保护成员、绑定与两季达标范围。"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors import Conflict
from platform_server.apps.hvac.crud import ac_unit_crud, room_crud
from platform_server.apps.hvac.errors import AcUnitNotFound
from platform_server.apps.hvac.models import AcUnit


async def lock_units(
    session: AsyncSession,
    unit_ids: frozenset[uuid.UUID],
    *,
    target_room_id: uuid.UUID | None = None,
) -> list[AcUnit]:
    """锁房间后复核机组归属，防止锁到已迁出的旧房间。

    Args: session, unit_ids, target_room_id。"""
    units = await ac_unit_crud.list_by_ids(session, unit_ids)
    if len(units) != len(unit_ids):
        raise AcUnitNotFound("有空调不存在，请刷新后重试")
    memberships = {unit.id: unit.room_id for unit in units}
    room_ids = frozenset(memberships.values())
    if target_room_id is not None:
        room_ids = room_ids | {target_room_id}
    # ⚠ 所有写入口先锁 Room，再写 AcUnit 或从表；逆序会与终态快照形成死锁。
    await room_crud.lock_configuration(session, room_ids)
    units = await ac_unit_crud.list_by_ids(session, unit_ids)
    if memberships != {unit.id: unit.room_id for unit in units}:
        raise Conflict("空调所属房间已变化，请刷新后重试")
    return units


async def lock_unit(session: AsyncSession, unit_id: uuid.UUID) -> AcUnit:
    """锁住一台空调的当前房间配置。Args: session, unit_id。"""
    return (await lock_units(session, frozenset({unit_id})))[0]
