"""ORM → 对外模型的转换。**ORM 模型绝不直接返给 HTTP 层。**

放在 service 边界而不是 api 层：转换要带上计数与所属车间，那是业务知识。
"""

from platform_server.apps.hvac.crud import RoomLocation
from platform_server.apps.hvac.models import AcUnit, Room, Workshop
from platform_server.apps.hvac.schemas import (
    AcUnitOut,
    RoomOut,
    RoomRef,
    WorkshopOut,
    WorkshopRef,
)


def to_workshop_out(
    workshop: Workshop, *, room_count: int, ac_unit_count: int
) -> WorkshopOut:
    """车间详情。

    Args: workshop, room_count, ac_unit_count。
    """
    return WorkshopOut(
        id=workshop.id,
        name=workshop.name,
        room_count=room_count,
        ac_unit_count=ac_unit_count,
        created_at=workshop.created_at,
        updated_at=workshop.updated_at,
    )


def to_room_out(
    room: Room, *, workshop: WorkshopRef, ac_unit_count: int
) -> RoomOut:
    """房间详情。

    Args: room, workshop, ac_unit_count。
    """
    return RoomOut(
        id=room.id,
        name=room.name,
        workshop=workshop,
        ac_unit_count=ac_unit_count,
        created_at=room.created_at,
        updated_at=room.updated_at,
    )


def to_workshop_ref(workshop: Workshop) -> WorkshopRef:
    """车间的引用形态。

    Args: workshop。
    """
    return WorkshopRef(id=workshop.id, name=workshop.name)


def location_to_workshop_ref(location: RoomLocation) -> WorkshopRef:
    """从批量取回的位置里取车间引用。

    Args: location。
    """
    return WorkshopRef(id=location.workshop_id, name=location.workshop_name)


def to_ac_unit_out(ac_unit: AcUnit, *, location: RoomLocation) -> AcUnitOut:
    """空调详情，所属位置逐级展开。

    Args: ac_unit, location。
    """
    return AcUnitOut(
        id=ac_unit.id,
        serial=ac_unit.serial,
        name=ac_unit.name,
        room=RoomRef(id=location.room_id, name=location.room_name),
        workshop=WorkshopRef(
            id=location.workshop_id, name=location.workshop_name
        ),
        created_at=ac_unit.created_at,
        updated_at=ac_unit.updated_at,
    )
