"""车间管理面。事务边界在这一层：crud 不提交，api 不写业务。"""

import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import get_logger
from lib.web import Page, PageParams
from platform_server.apps.hvac.crud import room_crud, workshop_crud
from platform_server.apps.hvac.crud.workshop import DEFAULT_ORDER, SORTABLE
from platform_server.apps.hvac.errors import (
    WorkshopNameTaken,
    WorkshopNotEmpty,
    WorkshopNotFound,
)
from platform_server.apps.hvac.models import Workshop
from platform_server.apps.hvac.schemas import (
    WorkshopCreateIn,
    WorkshopOut,
    WorkshopUpdateIn,
)
from platform_server.apps.hvac.services.changes import given_changes
from platform_server.apps.hvac.services.presenters import to_workshop_out

_logger = get_logger("platform.hvac.workshop")


async def list_workshops(
    session: AsyncSession,
    *,
    keyword: str | None,
    page: PageParams,
    sort: str | None,
) -> Page[WorkshopOut]:
    """车间列表。两个计数批量查，不逐行发查询。

    Args: session, keyword, page, sort。
    """
    statement = workshop_crud.order_by_whitelist(
        workshop_crud.build_query(keyword=keyword),
        sort=sort,
        allowed=dict(SORTABLE),
        default=DEFAULT_ORDER,
    )
    rows, total = await workshop_crud.list_page(
        session, statement=statement, offset=page.offset, limit=page.size
    )
    ids = frozenset(row.id for row in rows)
    rooms = await workshop_crud.room_counts(session, ids)
    units = await workshop_crud.ac_unit_counts(session, ids)
    return Page[WorkshopOut](
        items=[
            to_workshop_out(
                row,
                room_count=rooms.get(row.id, 0),
                ac_unit_count=units.get(row.id, 0),
            )
            for row in rows
        ],
        page=page.page,
        size=page.size,
        total=total,
    )


async def get_workshop(
    session: AsyncSession, workshop_id: uuid.UUID
) -> WorkshopOut:
    """车间详情。

    Args: session, workshop_id。
    """
    return await _present(session, await require_workshop(session, workshop_id))


async def create_workshop(
    session: AsyncSession, *, payload: WorkshopCreateIn
) -> WorkshopOut:
    """建车间。重名由唯一约束拦，不先查再插。

    Args: session, payload。
    """
    workshop = Workshop(name=payload.name)
    session.add(workshop)
    await _flush(session)
    _logger.info(
        "workshop_created",
        "车间已创建",
        workshop_id=str(workshop.id),
    )
    return await _present(session, workshop)


async def update_workshop(
    session: AsyncSession,
    *,
    workshop_id: uuid.UUID,
    payload: WorkshopUpdateIn,
) -> WorkshopOut:
    """改车间。缺省的字段不动。

    Args: session, workshop_id, payload。
    """
    workshop = await require_workshop(session, workshop_id)
    workshop_crud.apply_changes(workshop, given_changes(payload))
    await _flush(session)
    _logger.info("workshop_updated", "车间已更新", workshop_id=str(workshop.id))
    return await _present(session, workshop)


async def delete_workshop(
    session: AsyncSession, *, workshop_id: uuid.UUID
) -> None:
    """删车间。下面还有房间时拒绝——级联删会连着空调台账一起消失。

    Args: session, workshop_id。
    """
    workshop = await require_workshop(session, workshop_id)
    if await room_crud.count_by_workshop(session, workshop.id) > 0:
        raise WorkshopNotEmpty("该车间下还有房间，请先删除房间")
    _logger.info("workshop_deleted", "车间已删除", workshop_id=str(workshop.id))
    await workshop_crud.delete(session, workshop)


async def require_workshop(
    session: AsyncSession, workshop_id: uuid.UUID
) -> Workshop:
    """取车间，取不到即 404。本模块内其它 service 也用它。

    Args: session, workshop_id。
    """
    workshop = await workshop_crud.get(session, workshop_id)
    if workshop is None:
        raise WorkshopNotFound("车间不存在")
    return workshop


async def _present(session: AsyncSession, workshop: Workshop) -> WorkshopOut:
    ids = frozenset({workshop.id})
    rooms = await workshop_crud.room_counts(session, ids)
    units = await workshop_crud.ac_unit_counts(session, ids)
    return to_workshop_out(
        workshop,
        room_count=rooms.get(workshop.id, 0),
        ac_unit_count=units.get(workshop.id, 0),
    )


async def _flush(session: AsyncSession) -> None:
    try:
        await session.flush()
    except IntegrityError as error:
        raise WorkshopNameTaken("车间名已被占用") from error
