"""房间管理面。房间是空调互相影响的边界，删改都要看它里面还有没有空调。"""

import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import get_logger
from lib.web import Page, PageParams
from platform_server.apps.hvac.crud import ac_unit_crud, room_crud
from platform_server.apps.hvac.crud.room import DEFAULT_ORDER, SORTABLE
from platform_server.apps.hvac.errors import (
    RoomNameTaken,
    RoomNotEmpty,
    RoomNotFound,
)
from platform_server.apps.hvac.models import Room
from platform_server.apps.hvac.schemas import (
    RoomCreateIn,
    RoomOut,
    RoomUpdateIn,
)
from platform_server.apps.hvac.services.changes import given_changes
from platform_server.apps.hvac.services.presenters import (
    location_to_workshop_ref,
    to_room_out,
    to_workshop_ref,
)
from platform_server.apps.hvac.services.workshop_service import (
    require_workshop,
)

_logger = get_logger("platform.hvac.room")


async def list_rooms(
    session: AsyncSession,
    *,
    workshop_id: uuid.UUID | None,
    keyword: str | None,
    page: PageParams,
    sort: str | None,
) -> Page[RoomOut]:
    """房间列表，可按车间过滤。台数与车间名批量查。

    Args: session, workshop_id, keyword, page, sort。
    """
    statement = room_crud.order_by_whitelist(
        room_crud.build_query(workshop_id=workshop_id, keyword=keyword),
        sort=sort,
        allowed=dict(SORTABLE),
        default=DEFAULT_ORDER,
    )
    rows, total = await room_crud.list_page(
        session, statement=statement, offset=page.offset, limit=page.size
    )
    ids = frozenset(row.id for row in rows)
    counts = await room_crud.ac_unit_counts(session, ids)
    locations = await room_crud.locations(session, ids)
    return Page[RoomOut](
        items=[
            to_room_out(
                row,
                workshop=location_to_workshop_ref(locations[row.id]),
                ac_unit_count=counts.get(row.id, 0),
            )
            for row in rows
        ],
        page=page.page,
        size=page.size,
        total=total,
    )


async def get_room(session: AsyncSession, room_id: uuid.UUID) -> RoomOut:
    """房间详情。

    Args: session, room_id。
    """
    return await _present(session, await require_room(session, room_id))


async def create_room(
    session: AsyncSession, *, payload: RoomCreateIn
) -> RoomOut:
    """建房间。车间不存在即 404，同车间重名由唯一约束拦。

    Args: session, payload。
    """
    workshop = await require_workshop(session, payload.workshop_id)
    room = Room(workshop_id=workshop.id, name=payload.name)
    session.add(room)
    await _flush(session)
    _logger.info("room_created", "房间已创建", room_id=str(room.id))
    return to_room_out(
        room, workshop=to_workshop_ref(workshop), ac_unit_count=0
    )


async def update_room(
    session: AsyncSession, *, room_id: uuid.UUID, payload: RoomUpdateIn
) -> RoomOut:
    """改房间。给了 `workshop_id` 就把整间房连同里面的空调挪到别的车间。

    Args: session, room_id, payload。
    """
    room = await require_room(session, room_id)
    changes = given_changes(payload)
    target = changes.get("workshop_id")
    if isinstance(target, uuid.UUID):
        await require_workshop(session, target)
    room_crud.apply_changes(room, changes)
    await _flush(session)
    _logger.info("room_updated", "房间已更新", room_id=str(room.id))
    return await _present(session, room)


async def delete_room(session: AsyncSession, *, room_id: uuid.UUID) -> None:
    """删房间。里面还有空调时拒绝——先把它们改派到别的房间。

    Args: session, room_id。
    """
    room = await require_room(session, room_id)
    if await ac_unit_crud.count_by_room(session, room.id) > 0:
        raise RoomNotEmpty("该房间里还有空调，请先把它们改派到别的房间")
    _logger.info("room_deleted", "房间已删除", room_id=str(room.id))
    await room_crud.delete(session, room)


async def require_room(session: AsyncSession, room_id: uuid.UUID) -> Room:
    """取房间，取不到即 404。

    Args: session, room_id。
    """
    room = await room_crud.get(session, room_id)
    if room is None:
        raise RoomNotFound("房间不存在")
    return room


async def _present(session: AsyncSession, room: Room) -> RoomOut:
    workshop = await require_workshop(session, room.workshop_id)
    return to_room_out(
        room,
        workshop=to_workshop_ref(workshop),
        ac_unit_count=await ac_unit_crud.count_by_room(session, room.id),
    )


async def _flush(session: AsyncSession) -> None:
    try:
        await session.flush()
    except IntegrityError as error:
        raise RoomNameTaken("同一车间下已有同名房间") from error
