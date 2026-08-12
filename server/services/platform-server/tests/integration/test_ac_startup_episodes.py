"""开机事件表与人工排除表的持久层用例，打真实 Postgres。

守的是自然键 upsert 的幂等（队列是 at-least-once）、数组与 JSONB 的往返、
批次清理连同事件一起走，以及事件表那几条 CHECK 的拒绝路径。
"""

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.hvac.crud import (
    ac_startup_batch_crud,
    ac_startup_episode_crud,
    ac_startup_exclusion_crud,
)
from platform_server.apps.hvac.models import (
    AcStartupBatch,
    AcStartupEpisode,
    AcStartupExclusion,
    Room,
    Workshop,
)
from platform_server.apps.hvac.startups import (
    BATCH_RETENTION,
    BATCH_STATUS_READY,
    OUTCOME_SET_CHANGED,
    OUTCOME_TIMEOUT,
    OUTCOME_USABLE,
)

BASE = datetime(2026, 3, 1, 0, 0, tzinfo=UTC)
READINGS = {"K11": {"workshop_temp_avg": 26.5, "workshop_humidity_avg": None}}


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


def make_batch(room_id: uuid.UUID, *, created: int = 0) -> AcStartupBatch:
    """造一个批次实体。

    ⚠ `created_at` 显式给：`now()` 取的是事务开始时刻，同一个事务里建的几个
    批次会拿到一模一样的时间，「最近三个」这条排序就成了掷骰子。
    Args: room_id, created（建批次的分钟号）。
    """
    return AcStartupBatch(
        room_id=room_id,
        params_fingerprint="a" * 64,
        logic_version=1,
        window_start=at(0),
        window_end=at(1440),
        status=BATCH_STATUS_READY,
        created_at=at(created),
    )


def make_episode(
    batch: AcStartupBatch,
    *,
    minute: int = 30,
    outcome: str = OUTCOME_USABLE,
    running_set: Sequence[str] = ("K11",),
    complied_after: int | None = 20,
) -> AcStartupEpisode:
    """造一条事件实体；达标时刻由 complied_after 推出来，与 CHECK 保持一致。

    Args: batch, minute, outcome, running_set, complied_after。
    """
    complied_at = (
        None if complied_after is None else at(minute + complied_after)
    )
    return AcStartupEpisode(
        batch_id=batch.id,
        room_id=batch.room_id,
        started_at=at(minute),
        running_set=list(running_set),
        complied_at=complied_at,
        duration_minutes=complied_after,
        outcome=outcome,
        readings=READINGS,
    )


async def seeded_batch(
    session: AsyncSession, label: str
) -> tuple[uuid.UUID, AcStartupBatch]:
    """一个房间加一个已落库的批次。

    Args: session, label。
    """
    room_id = await make_room(session, label)
    batch = make_batch(room_id)
    session.add(batch)
    await session.flush()
    return room_id, batch


async def test_deleting_a_batch_takes_its_episodes_with_it(
    db_session: AsyncSession,
) -> None:
    """批次是派生数据，清理必须连同事件一起走，不留孤儿行。"""
    room_id = await make_room(db_session, "级联")
    doomed = make_batch(room_id, created=1)
    db_session.add(doomed)
    await db_session.flush()
    await ac_startup_episode_crud.upsert_many(
        db_session, [make_episode(doomed)]
    )
    for offset in (2, 3, 4):
        keeper = make_batch(room_id, created=offset)
        db_session.add(keeper)
        await db_session.flush()
    await ac_startup_batch_crud.prune(db_session, room_id, keep=BATCH_RETENTION)
    assert (
        await ac_startup_episode_crud.list_by_batch(db_session, doomed.id) == []
    )


async def test_episodes_are_keyed_by_batch_and_start(
    db_session: AsyncSession,
) -> None:
    """重复投递同一条事件是覆盖不是新增——队列是 at-least-once。"""
    _, batch = await seeded_batch(db_session, "幂等")
    await ac_startup_episode_crud.upsert_many(db_session, [make_episode(batch)])
    await ac_startup_episode_crud.upsert_many(
        db_session,
        [make_episode(batch, outcome=OUTCOME_TIMEOUT, complied_after=None)],
    )
    found = await ac_startup_episode_crud.list_by_batch(db_session, batch.id)
    assert len(found) == 1
    assert found[0].outcome == OUTCOME_TIMEOUT
    assert found[0].complied_at is None
    assert found[0].duration_minutes is None


async def test_writing_no_episodes_touches_nothing(
    db_session: AsyncSession,
) -> None:
    """空批次不该发出一条 INSERT。"""
    _, batch = await seeded_batch(db_session, "空批")
    await ac_startup_episode_crud.upsert_many(db_session, [])
    assert (
        await ac_startup_episode_crud.list_by_batch(db_session, batch.id) == []
    )


async def test_episodes_come_back_ordered_by_start(
    db_session: AsyncSession,
) -> None:
    """事件列表按起始时刻升序。"""
    _, batch = await seeded_batch(db_session, "排序")
    await ac_startup_episode_crud.upsert_many(
        db_session,
        [make_episode(batch, minute=200), make_episode(batch, minute=30)],
    )
    found = await ac_startup_episode_crud.list_by_batch(db_session, batch.id)
    assert [item.started_at for item in found] == [at(30), at(200)]


async def test_the_running_set_round_trips_as_a_text_array(
    db_session: AsyncSession,
) -> None:
    """组合按 serial 升序存成文本数组，取回来逐字相同。"""
    _, batch = await seeded_batch(db_session, "数组")
    await ac_startup_episode_crud.upsert_many(
        db_session, [make_episode(batch, running_set=("K11", "K12", "K14"))]
    )
    found = await ac_startup_episode_crud.list_by_batch(db_session, batch.id)
    assert found[0].running_set == ["K11", "K12", "K14"]


async def test_the_readings_round_trip_through_jsonb(
    db_session: AsyncSession,
) -> None:
    """起始帧读数原样存回，含 None。"""
    _, batch = await seeded_batch(db_session, "读数")
    await ac_startup_episode_crud.upsert_many(db_session, [make_episode(batch)])
    found = await ac_startup_episode_crud.list_by_batch(db_session, batch.id)
    assert found[0].readings == READINGS


async def test_counting_episodes_by_outcome(db_session: AsyncSession) -> None:
    """批次摘要要按结果分类计数。"""
    _, batch = await seeded_batch(db_session, "计数")
    await ac_startup_episode_crud.upsert_many(
        db_session,
        [
            make_episode(batch, minute=30),
            make_episode(batch, minute=200),
            make_episode(
                batch,
                minute=400,
                outcome=OUTCOME_SET_CHANGED,
                complied_after=None,
            ),
        ],
    )
    assert await ac_startup_episode_crud.count_by_outcome(
        db_session, batch.id
    ) == {OUTCOME_USABLE: 2, OUTCOME_SET_CHANGED: 1}


async def test_a_usable_episode_must_carry_a_compliance_moment(
    db_session: AsyncSession,
) -> None:
    """可用样本必须有达标时刻，否则「可用」这个标签没有依据。"""
    _, batch = await seeded_batch(db_session, "可用")
    db_session.add(make_episode(batch, complied_after=None))
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


async def test_a_discarded_episode_must_not_carry_a_compliance_moment(
    db_session: AsyncSession,
) -> None:
    """丢弃的事件不许带达标时刻，否则结果与事实自相矛盾。"""
    _, batch = await seeded_batch(db_session, "丢弃")
    db_session.add(make_episode(batch, outcome=OUTCOME_TIMEOUT))
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


async def test_an_empty_running_set_is_rejected(
    db_session: AsyncSession,
) -> None:
    """一次开机总得有台空调在跑。"""
    _, batch = await seeded_batch(db_session, "空组合")
    db_session.add(make_episode(batch, running_set=()))
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


async def test_an_unknown_outcome_is_rejected(
    db_session: AsyncSession,
) -> None:
    """结果取值由 CHECK 约束限定，不是原生 ENUM 也不能随便写。"""
    _, batch = await seeded_batch(db_session, "怪结果")
    db_session.add(make_episode(batch, outcome="maybe", complied_after=None))
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


async def test_exclusions_are_keyed_by_room_and_start(
    db_session: AsyncSession,
) -> None:
    """人工排除挂在自然键上，重算换掉事件行也不会把它冲掉。"""
    room_id = await make_room(db_session, "排除")
    await ac_startup_exclusion_crud.upsert(
        db_session,
        AcStartupExclusion(
            room_id=room_id,
            started_at=at(30),
            reason="现场在调试",
            excluded_by="测试员",
        ),
    )
    await ac_startup_exclusion_crud.upsert(
        db_session,
        AcStartupExclusion(
            room_id=room_id,
            started_at=at(30),
            reason="门开着",
            excluded_by="另一个人",
        ),
    )
    found = await ac_startup_exclusion_crud.list_by_room(db_session, room_id)
    assert len(found) == 1
    assert found[0].reason == "门开着"
    assert found[0].excluded_by == "另一个人"


async def test_deleting_an_exclusion_by_its_natural_key(
    db_session: AsyncSession,
) -> None:
    """按自然键取消排除。"""
    room_id = await make_room(db_session, "取消")
    await ac_startup_exclusion_crud.upsert(
        db_session,
        AcStartupExclusion(
            room_id=room_id,
            started_at=at(30),
            reason="现场在调试",
            excluded_by="测试员",
        ),
    )
    assert (
        await ac_startup_exclusion_crud.delete_by_key(
            db_session, room_id, at(30)
        )
        == 1
    )
    assert (
        await ac_startup_exclusion_crud.list_by_room(db_session, room_id) == []
    )


async def test_deleting_an_absent_exclusion_removes_nothing(
    db_session: AsyncSession,
) -> None:
    """没排除过也算成功——取消是幂等的。"""
    room_id = await make_room(db_session, "没排除")
    assert (
        await ac_startup_exclusion_crud.delete_by_key(
            db_session, room_id, at(30)
        )
        == 0
    )


async def test_an_empty_exclusion_reason_is_rejected(
    db_session: AsyncSession,
) -> None:
    """排除必须写原因，空原因等于没排除理由。"""
    room_id = await make_room(db_session, "空原因")
    db_session.add(
        AcStartupExclusion(
            room_id=room_id,
            started_at=at(30),
            reason="",
            excluded_by="测试员",
        )
    )
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()
