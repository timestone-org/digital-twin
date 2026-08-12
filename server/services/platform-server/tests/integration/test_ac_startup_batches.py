"""抽取批次表的持久层用例，打真实 Postgres。

守的是只有真库才成立的那几条：一个房间只能有一个当前批次（部分唯一索引）、
原子切换、只保留最近几个批次，以及状态与区间两条 CHECK 的拒绝路径。
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.hvac.crud import ac_startup_batch_crud
from platform_server.apps.hvac.models import AcStartupBatch, Room, Workshop
from platform_server.apps.hvac.startups import (
    BATCH_RETENTION,
    BATCH_STATUS_READY,
)

BASE = datetime(2026, 3, 1, 0, 0, tzinfo=UTC)


def at(minute: int) -> datetime:
    """基准时刻起的第 n 分钟。

    Args: minute。
    """
    return BASE + timedelta(minutes=minute)


async def make_room(session: AsyncSession, label: str) -> uuid.UUID:
    """建一个车间与一个房间，返回房间 id。

    Args: session, label。
    """
    workshop = Workshop(name=f"{label}车间{uuid.uuid4().hex[:8]}")
    session.add(workshop)
    await session.flush()
    room = Room(workshop_id=workshop.id, name=f"{label}房")
    session.add(room)
    await session.flush()
    return room.id


def make_batch(
    room_id: uuid.UUID,
    *,
    status: str = BATCH_STATUS_READY,
    is_current: bool = False,
    created: int = 0,
) -> AcStartupBatch:
    """造一个批次实体，调用方自己 add 与 flush。

    ⚠ `created_at` 显式给：`now()` 取的是事务开始时刻，同一个事务里建的几个
    批次会拿到一模一样的时间，「最近三个」这条排序就成了掷骰子。
    Args: room_id, status, is_current, created（建批次的分钟号）。
    """
    return AcStartupBatch(
        room_id=room_id,
        params_fingerprint="a" * 64,
        logic_version=1,
        window_start=at(0),
        window_end=at(1440),
        status=status,
        is_current=is_current,
        created_at=at(created),
    )


async def seeded_batches(
    session: AsyncSession, room_id: uuid.UUID, count: int
) -> list[AcStartupBatch]:
    """按建立时刻先后落几个批次，最老的在前。

    Args: session, room_id, count。
    """
    batches = [
        make_batch(room_id, created=offset) for offset in range(1, count + 1)
    ]
    for batch in batches:
        session.add(batch)
        await session.flush()
    return batches


async def test_a_room_can_only_have_one_current_batch(
    db_session: AsyncSession,
) -> None:
    """部分唯一索引在库里拦住第二个 is_current，不靠代码自觉。"""
    room_id = await make_room(db_session, "唯一")
    db_session.add(make_batch(room_id, is_current=True))
    await db_session.flush()
    db_session.add(make_batch(room_id, is_current=True))
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


async def test_two_rooms_may_each_have_a_current_batch(
    db_session: AsyncSession,
) -> None:
    """部分唯一索引只按房间去重，别的房间不受影响。"""
    first = await make_room(db_session, "甲")
    second = await make_room(db_session, "乙")
    db_session.add(make_batch(first, is_current=True))
    db_session.add(make_batch(second, is_current=True))
    await db_session.flush()
    assert await ac_startup_batch_crud.find_current(db_session, first)
    assert await ac_startup_batch_crud.find_current(db_session, second)


async def test_promoting_a_batch_demotes_the_previous_current_one(
    db_session: AsyncSession,
) -> None:
    """原子切换：让位与就位在同一个事务里，中途没有「两个都当前」的瞬间。"""
    room_id = await make_room(db_session, "切换")
    old = make_batch(room_id, is_current=True)
    db_session.add(old)
    await db_session.flush()
    fresh = make_batch(room_id)
    db_session.add(fresh)
    await ac_startup_batch_crud.promote_current(db_session, fresh)
    current = await ac_startup_batch_crud.find_current(db_session, room_id)
    assert current is not None
    assert current.id == fresh.id
    assert old.is_current is False


async def test_promoting_the_current_batch_again_keeps_it_current(
    db_session: AsyncSession,
) -> None:
    """重复切换同一个批次不会把它自己让下去。"""
    room_id = await make_room(db_session, "重复")
    batch = make_batch(room_id)
    db_session.add(batch)
    await ac_startup_batch_crud.promote_current(db_session, batch)
    await ac_startup_batch_crud.promote_current(db_session, batch)
    current = await ac_startup_batch_crud.find_current(db_session, room_id)
    assert current is not None
    assert current.id == batch.id


async def test_a_room_without_a_current_batch_reports_none(
    db_session: AsyncSession,
) -> None:
    """还没算过的房间没有当前批次。"""
    room_id = await make_room(db_session, "空房")
    assert await ac_startup_batch_crud.find_current(db_session, room_id) is None


async def test_listing_batches_puts_the_newest_first(
    db_session: AsyncSession,
) -> None:
    """批次列表最新的在前，且不超过要的条数。"""
    room_id = await make_room(db_session, "列表")
    batches = await seeded_batches(db_session, room_id, 4)
    found = await ac_startup_batch_crud.list_by_room(
        db_session, room_id, limit=2
    )
    assert [item.id for item in found] == [batches[3].id, batches[2].id]


async def test_pruning_keeps_only_the_newest_batches(
    db_session: AsyncSession,
) -> None:
    """每个房间保留最近三个批次，更老的清理掉。"""
    room_id = await make_room(db_session, "清理")
    batches = await seeded_batches(db_session, room_id, 5)
    removed = await ac_startup_batch_crud.prune(
        db_session, room_id, keep=BATCH_RETENTION
    )
    assert set(removed) == {batches[0].id, batches[1].id}
    kept = await ac_startup_batch_crud.list_by_room(
        db_session, room_id, limit=10
    )
    assert len(kept) == BATCH_RETENTION


async def test_pruning_never_removes_the_current_batch(
    db_session: AsyncSession,
) -> None:
    """⚠ 当前批次永远不删：重算期间页面显示的就是它。"""
    room_id = await make_room(db_session, "护当前")
    batches = await seeded_batches(db_session, room_id, 5)
    await ac_startup_batch_crud.promote_current(db_session, batches[0])
    removed = await ac_startup_batch_crud.prune(db_session, room_id, keep=2)
    assert set(removed) == {batches[1].id, batches[2].id}


async def test_pruning_a_room_within_the_limit_removes_nothing(
    db_session: AsyncSession,
) -> None:
    """批次数还没超保留数时，一条都不该删。"""
    room_id = await make_room(db_session, "未超")
    await seeded_batches(db_session, room_id, 1)
    assert (
        await ac_startup_batch_crud.prune(
            db_session, room_id, keep=BATCH_RETENTION
        )
        == []
    )


async def test_an_unknown_batch_status_is_rejected(
    db_session: AsyncSession,
) -> None:
    """批次状态由 CHECK 限定取值，不是原生 ENUM 也不能随便写。"""
    room_id = await make_room(db_session, "怪状态")
    db_session.add(make_batch(room_id, status="paused"))
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


async def test_a_batch_window_must_be_ordered(
    db_session: AsyncSession,
) -> None:
    """倒置的抽取区间抽不出任何东西，直接在库里拦住。"""
    room_id = await make_room(db_session, "倒置")
    batch = make_batch(room_id)
    batch.window_end = batch.window_start
    db_session.add(batch)
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()
