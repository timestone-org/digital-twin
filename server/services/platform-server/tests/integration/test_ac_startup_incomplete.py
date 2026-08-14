"""不完整的批次绝不许成为当前批次（AC_STARTUP_DESIGN.md §5），打真实 Postgres。

守的是两道闸而不是一道：收尾那段代码要拒绝，库里的两条 CHECK 也要拒绝。
⚠ 第二道不是冗余——线上那份空批次正是绕过应用改库改出来的，43/45 的批次被直接
改成 ready + is_current，把 63 条事件的那份数据从页面上换了下去。

同一批用例还守分片的终态：批次一旦不在跑，还在路上的那些分片必须各自落一个终
态。它们的消息照样会被确认，`claim_stale` 不会再送第二遍——停在 pending 就是
永远停在那里，批次于是卡在 43/45 而队列里一条消息都没有。
"""

import uuid
from datetime import UTC, datetime
from typing import cast

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.hvac.crud import (
    ac_startup_batch_crud,
    ac_startup_episode_crud,
    ac_startup_shard_crud,
)
from platform_server.apps.hvac.models import (
    AcStartupEpisode,
    AcStartupShard,
    Room,
    Workshop,
)
from platform_server.apps.hvac.schemas import TimeWindow
from platform_server.apps.hvac.services.ac_source_reader import AcSourceReader
from platform_server.apps.hvac.services.ac_startup_extract import (
    SHARD_RUN_SKIPPED,
    ExtractionContext,
    run_shard,
)
from platform_server.apps.hvac.services.ac_startup_rules import ExtractionRules
from platform_server.apps.hvac.services.ac_startup_service import (
    fail_shard,
    finalize_if_complete,
    request_rebuild,
)
from platform_server.apps.hvac.startups import (
    OUTCOME_USABLE,
    SHARD_STATUS_DONE,
    SHARD_STATUS_PENDING,
)

RULES = ExtractionRules()
# 抽取区间：1 月与 2 月两片
WINDOW = TimeWindow(
    start=datetime(2026, 1, 1, tzinfo=UTC), end=datetime(2026, 3, 1, tzinfo=UTC)
)


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


def bare_context() -> ExtractionContext:
    """一份不会走到取数的上下文。

    ⚠ cast 的理由：这些用例的房间一台空调都没绑，取数面根本不会被碰到。
    """
    return ExtractionContext(
        reader=cast(AcSourceReader, object()), rules=RULES, max_rows=1
    )


async def test_a_shard_of_a_failed_batch_never_stays_pending(
    db_session: AsyncSession,
) -> None:
    """一片失败之后，还在路上的那些分片必须各自落一个终态。"""
    room_id = await make_room(db_session, "半路判失败")
    plan = await request_rebuild(
        db_session, room_id=room_id, window=WINDOW, rules=RULES
    )
    await fail_shard(db_session, plan.messages[0], reason="外部数据源不可用")
    assert await finalize_if_complete(db_session, plan.batch.id) is not None

    stray = await run_shard(db_session, bare_context(), plan.messages[1])
    assert stray.outcome == SHARD_RUN_SKIPPED
    statuses = {
        shard.status
        for shard in await ac_startup_shard_crud.list_by_batch(
            db_session, plan.batch.id
        )
    }
    assert SHARD_STATUS_PENDING not in statuses


async def test_an_extra_shard_row_cannot_stand_in_for_one_that_never_ran(
    db_session: AsyncSession,
) -> None:
    """⚠ 收尾要比的是「每一片都跑完了」，不是「done 够不够多」。

    分片行按 `(batch_id, month)` 落，没有任何一处校验这个月份属不属于本批次的
    计划——多出来的一行 done 于是能替一片没跑的顶上，凑够数就切成当前批次。
    """
    room_id = await make_room(db_session, "凑数")
    plan = await request_rebuild(
        db_session, room_id=room_id, window=WINDOW, rules=RULES
    )
    await ac_startup_shard_crud.mark(
        db_session,
        AcStartupShard(batch_id=plan.batch.id, month="2026-01"),
        status=SHARD_STATUS_DONE,
    )
    # 计划外的一行 done：2 月那片始终没跑，但 done 的行数已经够 2 了
    await ac_startup_shard_crud.mark(
        db_session,
        AcStartupShard(batch_id=plan.batch.id, month="2025-12"),
        status=SHARD_STATUS_DONE,
    )

    assert await finalize_if_complete(db_session, plan.batch.id) is None
    assert await ac_startup_batch_crud.find_current(db_session, room_id) is None


async def test_the_database_refuses_to_make_an_incomplete_batch_current(
    db_session: AsyncSession,
) -> None:
    """⚠ 缺着片就切成当前批次，绕开应用直接改库也不行。"""
    room_id = await make_room(db_session, "缺片上台")
    plan = await request_rebuild(
        db_session, room_id=room_id, window=WINDOW, rules=RULES
    )
    with pytest.raises(IntegrityError):
        await db_session.execute(
            text(
                "UPDATE platform.hvac_ac_startup_batches "
                "SET status = 'ready', is_current = true WHERE id = :id"
            ),
            {"id": plan.batch.id},
        )
    await db_session.rollback()


async def test_the_database_refuses_a_current_batch_that_is_still_running(
    db_session: AsyncSession,
) -> None:
    """还在跑的批次不许挂当前批次的牌子：页面拿到的会是半份数据。"""
    room_id = await make_room(db_session, "跑着上台")
    plan = await request_rebuild(
        db_session, room_id=room_id, window=WINDOW, rules=RULES
    )
    with pytest.raises(IntegrityError):
        await db_session.execute(
            text(
                "UPDATE platform.hvac_ac_startup_batches "
                "SET is_current = true WHERE id = :id"
            ),
            {"id": plan.batch.id},
        )
    await db_session.rollback()


async def test_the_episode_count_grows_as_the_shards_finish(
    db_session: AsyncSession,
) -> None:
    """⚠ 事件数不能等到切换那一刻才算。

    批次卡住时它会一直读 0，而库里明明躺着几百条——线上那份 945 条的数据在
    页面上就是 0 条。
    """
    room_id = await make_room(db_session, "边跑边计数")
    plan = await request_rebuild(
        db_session, room_id=room_id, window=WINDOW, rules=RULES
    )
    await ac_startup_episode_crud.upsert_many(
        db_session,
        [
            AcStartupEpisode(
                batch_id=plan.batch.id,
                room_id=room_id,
                started_at=datetime(2026, 1, 5, 3, 0, tzinfo=UTC),
                running_set=["K11"],
                complied_at=datetime(2026, 1, 5, 3, 30, tzinfo=UTC),
                duration_minutes=30,
                outcome=OUTCOME_USABLE,
                readings={"K11": {"workshop_temp_avg": 28.0}},
            )
        ],
    )
    await ac_startup_shard_crud.mark(
        db_session,
        AcStartupShard(batch_id=plan.batch.id, month="2026-01"),
        status=SHARD_STATUS_DONE,
    )

    assert await finalize_if_complete(db_session, plan.batch.id) is None
    await db_session.flush()
    stored = await db_session.scalar(
        text(
            "SELECT episode_count FROM platform.hvac_ac_startup_batches "
            "WHERE id = :id"
        ),
        {"id": plan.batch.id},
    )
    assert stored == 1
