"""空调台账面。设备编号全场唯一，房间必填——空调不允许处于无归属的中间态。"""

import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import get_logger
from lib.web import Page, PageParams
from platform_server.apps.hvac.crud import RoomLocation, ac_unit_crud, room_crud
from platform_server.apps.hvac.crud.ac_unit import DEFAULT_ORDER, SORTABLE
from platform_server.apps.hvac.errors import (
    AcUnitNotFound,
    AcUnitSerialTaken,
    RoomNotFound,
)
from platform_server.apps.hvac.models import AcUnit
from platform_server.apps.hvac.schemas import (
    AcUnitCreateIn,
    AcUnitFilters,
    AcUnitOut,
    AcUnitRelocateIn,
    AcUnitRelocateOut,
    AcUnitUpdateIn,
    RoomRef,
)
from platform_server.apps.hvac.services.changes import given_changes
from platform_server.apps.hvac.services.presenters import (
    location_to_workshop_ref,
    to_ac_unit_out,
)

_logger = get_logger("platform.hvac.ac_unit")


async def list_ac_units(
    session: AsyncSession,
    *,
    filters: AcUnitFilters,
    page: PageParams,
    sort: str | None,
) -> Page[AcUnitOut]:
    """空调列表。所属位置一次批量取回，不逐行回查。

    Args: session, filters, page, sort。
    """
    statement = ac_unit_crud.order_by_whitelist(
        ac_unit_crud.build_query(filters),
        sort=sort,
        allowed=dict(SORTABLE),
        default=DEFAULT_ORDER,
    )
    rows, total = await ac_unit_crud.list_page(
        session, statement=statement, offset=page.offset, limit=page.size
    )
    locations = await room_crud.locations(
        session, frozenset(row.room_id for row in rows)
    )
    return Page[AcUnitOut](
        items=[
            to_ac_unit_out(row, location=locations[row.room_id]) for row in rows
        ],
        page=page.page,
        size=page.size,
        total=total,
    )


async def get_ac_unit(
    session: AsyncSession, ac_unit_id: uuid.UUID
) -> AcUnitOut:
    """空调详情。

    Args: session, ac_unit_id。
    """
    return await _present(session, await _require_ac_unit(session, ac_unit_id))


async def create_ac_unit(
    session: AsyncSession, *, payload: AcUnitCreateIn
) -> AcUnitOut:
    """建空调。房间不存在即 404，编号重复由唯一约束拦。

    Args: session, payload。
    """
    location = await _require_location(session, payload.room_id)
    ac_unit = AcUnit(
        room_id=location.room_id, serial=payload.serial, name=payload.name
    )
    session.add(ac_unit)
    await _flush(session)
    _logger.info("ac_unit_created", "空调已建档", ac_unit_id=str(ac_unit.id))
    return to_ac_unit_out(ac_unit, location=location)


async def update_ac_unit(
    session: AsyncSession, *, ac_unit_id: uuid.UUID, payload: AcUnitUpdateIn
) -> AcUnitOut:
    """改空调。给了 `room_id` 就是把它挪到别的房间。

    Args: session, ac_unit_id, payload。
    """
    ac_unit = await _require_ac_unit(session, ac_unit_id)
    changes = given_changes(payload)
    target = changes.get("room_id")
    if isinstance(target, uuid.UUID):
        await _require_location(session, target)
    ac_unit_crud.apply_changes(ac_unit, changes)
    await _flush(session)
    _logger.info("ac_unit_updated", "空调已更新", ac_unit_id=str(ac_unit.id))
    return await _present(session, ac_unit)


async def delete_ac_unit(
    session: AsyncSession, *, ac_unit_id: uuid.UUID
) -> None:
    """删空调。

    Args: session, ac_unit_id。
    """
    ac_unit = await _require_ac_unit(session, ac_unit_id)
    _logger.info("ac_unit_deleted", "空调已删除", ac_unit_id=str(ac_unit.id))
    await ac_unit_crud.delete(session, ac_unit)


async def relocate_ac_units(
    session: AsyncSession, *, payload: AcUnitRelocateIn
) -> AcUnitRelocateOut:
    """把一批空调改派到同一个房间。

    ⚠ 任一 id 不存在即整批 404：批量操作静默跳过找不到的那些，会让调用方
    以为全部生效了。
    Args: session, payload。
    """
    location = await _require_location(session, payload.room_id)
    requested = frozenset(payload.ac_unit_ids)
    found = await ac_unit_crud.list_by_ids(session, requested)
    if len(found) != len(requested):
        raise AcUnitNotFound("有空调不存在，请刷新后重试")
    moved = [item for item in found if item.room_id != location.room_id]
    for item in moved:
        item.room_id = location.room_id
    await session.flush()
    _logger.info(
        "ac_units_relocated",
        "空调已改派",
        room_id=str(location.room_id),
        moved_count=len(moved),
    )
    return AcUnitRelocateOut(
        moved_count=len(moved),
        room=RoomRef(id=location.room_id, name=location.room_name),
        workshop=location_to_workshop_ref(location),
    )


async def _require_ac_unit(
    session: AsyncSession, ac_unit_id: uuid.UUID
) -> AcUnit:
    ac_unit = await ac_unit_crud.get(session, ac_unit_id)
    if ac_unit is None:
        raise AcUnitNotFound("空调不存在")
    return ac_unit


async def _require_location(
    session: AsyncSession, room_id: uuid.UUID
) -> RoomLocation:
    locations = await room_crud.locations(session, frozenset({room_id}))
    location = locations.get(room_id)
    if location is None:
        raise RoomNotFound("房间不存在")
    return location


async def _present(session: AsyncSession, ac_unit: AcUnit) -> AcUnitOut:
    return to_ac_unit_out(
        ac_unit, location=await _require_location(session, ac_unit.room_id)
    )


async def _flush(session: AsyncSession) -> None:
    try:
        await session.flush()
    except IntegrityError as error:
        raise AcUnitSerialTaken("空调序号已被占用") from error
