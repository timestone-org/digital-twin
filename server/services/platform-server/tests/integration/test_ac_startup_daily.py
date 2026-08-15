"""每日增量打真实 Postgres：追进当前批次、整窗替换、指纹不符即跳过。

⚠ 最要紧的两条：
1. **重跑同一天结果不变**——整窗替换是这条链路上唯一自洽的幂等方式。
2. **昨夜的尾巴会被重判**——归属区间往回退一个达标上限，22:20 之后开的机
   在今晚拿到完整数据后改判，而不是永久定格成「没达标」。
"""

import uuid
from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.hvac.crud import (
    ac_startup_batch_crud,
    ac_startup_episode_crud,
    ac_startup_exclusion_crud,
)
from platform_server.apps.hvac.models import (
    AcDataBinding,
    AcMetricLimit,
    AcStartupBatch,
    AcStartupExclusion,
    AcUnit,
    Room,
    Workshop,
)
from platform_server.apps.hvac.schemas import TimeWindow
from platform_server.apps.hvac.services.ac_source_reader import (
    AcSourceReader,
    SourceRow,
)
from platform_server.apps.hvac.services.ac_startup_daily import (
    DAILY_RUN_APPENDED,
    DAILY_RUN_SKIPPED,
    append_day,
    day_bounds,
)
from platform_server.apps.hvac.services.ac_startup_extract import (
    ExtractionContext,
)
from platform_server.apps.hvac.services.ac_startup_rules import (
    LOGIC_VERSION,
    ExtractionRules,
)
from platform_server.apps.hvac.startups import (
    BATCH_STATUS_READY,
    OUTCOME_USABLE,
)

pytestmark = pytest.mark.requires_postgres

RULES = ExtractionRules()
SHANGHAI = "Asia/Shanghai"
SOURCE_OBJECT = "KTStartData_K11"
DAY = date(2026, 8, 12)
# 当天 09:00 本地时 = 01:00 UTC，稳稳落在归属区间中段
STARTED_AT = datetime(2026, 8, 12, 1, 0, tzinfo=UTC)
COMPLIED_AT = STARTED_AT + timedelta(minutes=20)


class StubReader(AcSourceReader):
    """替掉取数的读取面，其余装配照旧。"""

    def __init__(self, rows: Sequence[SourceRow]) -> None:
        self.rows = list(rows)
        self.windows: list[tuple[datetime, datetime]] = []

    async def fetch_samples(
        self,
        *,
        source_object: str,
        columns: Sequence[str],
        window: TimeWindow,
        row_limit: int,
    ) -> list[SourceRow]:
        del source_object, columns, row_limit
        self.windows.append((window.start, window.end))
        return [row for row in self.rows if window.start <= row.ts < window.end]


def row(ts: datetime, *, celsius: float, frequency: float) -> SourceRow:
    """一行源数据。

    Args: ts, celsius, frequency。
    """
    return SourceRow(
        ts=ts,
        values={
            "workshop_temp_avg": celsius,
            "workshop_humidity_avg": 55.0,
            "fan_frequency": frequency,
        },
    )


def one_startup(started_at: datetime, complied_at: datetime) -> list[SourceRow]:
    """全停 40 分钟 → 起机 → 达标 → 再跑 30 分钟。

    Args: started_at, complied_at。
    """
    rows: list[SourceRow] = []
    cursor = started_at - timedelta(minutes=40)
    while cursor < started_at:
        rows.append(row(cursor, celsius=28.0, frequency=0.0))
        cursor += timedelta(minutes=1)
    while cursor < complied_at:
        rows.append(row(cursor, celsius=27.0, frequency=40.0))
        cursor += timedelta(minutes=1)
    while cursor < complied_at + timedelta(minutes=30):
        rows.append(row(cursor, celsius=24.0, frequency=40.0))
        cursor += timedelta(minutes=1)
    return rows


def context_for(rows: Sequence[SourceRow]) -> ExtractionContext:
    """一份跑抽取用的上下文。

    Args: rows。
    """
    return ExtractionContext(
        reader=StubReader(rows), rules=RULES, max_rows=100000
    )


async def make_room(session: AsyncSession, label: str) -> uuid.UUID:
    """建车间、房间、空调、数据源绑定与达标范围，返回房间 id。

    Args: session, label。
    """
    workshop = Workshop(name=f"{label}车间{uuid.uuid4().hex[:8]}")
    session.add(workshop)
    await session.flush()
    room = Room(workshop_id=workshop.id, name=f"{label}房")
    session.add(room)
    await session.flush()
    unit = AcUnit(
        room_id=room.id, serial=f"K11-{uuid.uuid4().hex[:6]}", name="机组"
    )
    session.add(unit)
    await session.flush()
    session.add(
        AcDataBinding(
            ac_unit_id=unit.id,
            dataset="raw_minute",
            source_object=SOURCE_OBJECT,
        )
    )
    session.add(
        AcMetricLimit(
            ac_unit_id=unit.id,
            metric="workshop_temp_avg",
            lower_limit=None,
            upper_limit=26,
        )
    )
    await session.flush()
    return room.id


async def seed_batch(
    session: AsyncSession,
    room_id: uuid.UUID,
    *,
    fingerprint: str | None = None,
    logic_version: int | None = None,
) -> AcStartupBatch:
    """给房间种一个当前批次，窗口停在这一天开始之前。

    Args: session, room_id, fingerprint, logic_version。
    """
    bounds = day_bounds(DAY, SHANGHAI)
    batch = AcStartupBatch(
        room_id=room_id,
        params_fingerprint=fingerprint or RULES.fingerprint(),
        logic_version=(
            LOGIC_VERSION if logic_version is None else logic_version
        ),
        window_start=bounds.start - timedelta(days=30),
        window_end=bounds.start,
        status=BATCH_STATUS_READY,
        is_current=True,
        shard_total=1,
        shard_done=1,
        episode_count=0,
    )
    session.add(batch)
    await session.flush()
    return batch


async def test_a_day_lands_in_the_current_batch(
    db_session: AsyncSession,
) -> None:
    """当天的开机事件补进当前批次，并顺延批次窗口与事件计数。"""
    room_id = await make_room(db_session, "日增")
    batch = await seed_batch(db_session, room_id)
    run = await append_day(
        db_session,
        context_for(one_startup(STARTED_AT, COMPLIED_AT)),
        room_id=room_id,
        day=DAY,
        timezone=SHANGHAI,
    )
    assert run.outcome == DAILY_RUN_APPENDED
    assert run.appended == 1
    episodes = await ac_startup_episode_crud.list_by_batch(db_session, batch.id)
    assert [item.started_at for item in episodes] == [STARTED_AT]
    assert episodes[0].outcome == OUTCOME_USABLE
    assert episodes[0].duration_minutes == 20
    assert batch.window_end == day_bounds(DAY, SHANGHAI).end
    assert batch.episode_count == 1


async def test_rerunning_the_same_day_changes_nothing(
    db_session: AsyncSession,
) -> None:
    """重跑同一天不许留下第二条——队列是 at-least-once。"""
    room_id = await make_room(db_session, "重跑")
    batch = await seed_batch(db_session, room_id)
    context = context_for(one_startup(STARTED_AT, COMPLIED_AT))
    for _ in range(3):
        await append_day(
            db_session,
            context,
            room_id=room_id,
            day=DAY,
            timezone=SHANGHAI,
        )
    episodes = await ac_startup_episode_crud.list_by_batch(db_session, batch.id)
    assert len(episodes) == 1
    assert batch.episode_count == 1


async def test_a_shifted_start_replaces_the_old_row_instead_of_doubling(
    db_session: AsyncSession,
) -> None:
    """重判后起始时刻平移了，旧那一行必须消失。

    ⚠ 只 upsert 不删的话，同一次开机会在库里留下两条——两条的键不同，
    没有任何约束会拦住它，而训练集里那次开机就被数了两遍。
    """
    room_id = await make_room(db_session, "平移")
    batch = await seed_batch(db_session, room_id)
    await append_day(
        db_session,
        context_for(one_startup(STARTED_AT, COMPLIED_AT)),
        room_id=room_id,
        day=DAY,
        timezone=SHANGHAI,
    )
    moved = STARTED_AT + timedelta(minutes=7)
    await append_day(
        db_session,
        context_for(one_startup(moved, moved + timedelta(minutes=20))),
        room_id=room_id,
        day=DAY,
        timezone=SHANGHAI,
    )
    episodes = await ac_startup_episode_crud.list_by_batch(db_session, batch.id)
    assert [item.started_at for item in episodes] == [moved]


async def test_last_nights_tail_is_rejudged_by_tonights_run(
    db_session: AsyncSession,
) -> None:
    """22:20 之后开的机在第二晚被重判，而不是永久定格。

    ⚠ 这正是归属区间往回退一个达标上限的理由：昨晚 00:00 跑那一次时，
    这次开机的达标帧还没产生。
    """
    room_id = await make_room(db_session, "尾巴")
    batch = await seed_batch(db_session, room_id)
    # 当天 23:30 本地时 = 15:30 UTC，达标落在次日 00:10 本地时
    tail_start = day_bounds(DAY, SHANGHAI).end - timedelta(minutes=30)
    rows = one_startup(tail_start, tail_start + timedelta(minutes=40))
    run = await append_day(
        db_session,
        context_for(rows),
        room_id=room_id,
        day=DAY + timedelta(days=1),
        timezone=SHANGHAI,
    )
    assert run.outcome == DAILY_RUN_APPENDED
    episodes = await ac_startup_episode_crud.list_by_batch(db_session, batch.id)
    assert [item.started_at for item in episodes] == [tail_start]
    assert episodes[0].outcome == OUTCOME_USABLE


async def test_a_room_without_a_current_batch_is_skipped_with_a_reason(
    db_session: AsyncSession,
) -> None:
    """没有当前批次就没有可追加的地方——跳过并说清为什么。"""
    room_id = await make_room(db_session, "无批次")
    run = await append_day(
        db_session,
        context_for([]),
        room_id=room_id,
        day=DAY,
        timezone=SHANGHAI,
    )
    assert run.outcome == DAILY_RUN_SKIPPED
    assert "全量抽取" in (run.reason or "")


async def test_a_fingerprint_mismatch_skips_instead_of_mixing_two_rulesets(
    db_session: AsyncSession,
) -> None:
    """批次是按别的参数算的，就不许往里追。

    ⚠ 混两套规则算出的事件比缺一天更糟：页面上这批数据会声称自己按某一个
    指纹算过，而其中一部分不是。
    """
    room_id = await make_room(db_session, "指纹")
    batch = await seed_batch(db_session, room_id, fingerprint="f" * 64)
    run = await append_day(
        db_session,
        context_for(one_startup(STARTED_AT, COMPLIED_AT)),
        room_id=room_id,
        day=DAY,
        timezone=SHANGHAI,
    )
    assert run.outcome == DAILY_RUN_SKIPPED
    assert "全量重算" in (run.reason or "")
    episodes = await ac_startup_episode_crud.list_by_batch(db_session, batch.id)
    assert episodes == []


async def test_an_older_logic_version_skips_too(
    db_session: AsyncSession,
) -> None:
    """抽取逻辑升过版的批次同样不许往里追。"""
    room_id = await make_room(db_session, "版本")
    await seed_batch(db_session, room_id, logic_version=LOGIC_VERSION - 1)
    run = await append_day(
        db_session,
        context_for(one_startup(STARTED_AT, COMPLIED_AT)),
        room_id=room_id,
        day=DAY,
        timezone=SHANGHAI,
    )
    assert run.outcome == DAILY_RUN_SKIPPED
    assert "抽取逻辑" in (run.reason or "")


async def test_a_manual_exclusion_survives_the_window_replace(
    db_session: AsyncSession,
) -> None:
    """人工排除挂在自然键上，整窗替换删不掉它。

    ⚠ 这正是当初把排除挂在 `(room_id, started_at)` 而不是事件行上的理由。
    """
    room_id = await make_room(db_session, "排除")
    await seed_batch(db_session, room_id)
    db_session.add(
        AcStartupExclusion(
            room_id=room_id,
            started_at=STARTED_AT,
            reason="这次是调试",
            excluded_by="tester",
        )
    )
    await db_session.flush()
    await append_day(
        db_session,
        context_for(one_startup(STARTED_AT, COMPLIED_AT)),
        room_id=room_id,
        day=DAY,
        timezone=SHANGHAI,
    )
    found = await ac_startup_batch_crud.find_current(db_session, room_id)
    assert found is not None
    # 事件行被整窗换过一遍
    assert (
        len(await ac_startup_episode_crud.list_by_batch(db_session, found.id))
        == 1
    )
    # 而挂在自然键上的人工排除还在
    kept = await ac_startup_exclusion_crud.find(
        db_session, room_id=room_id, started_at=STARTED_AT
    )
    assert kept is not None
    assert kept.reason == "这次是调试"


async def test_the_window_end_only_moves_forward(
    db_session: AsyncSession,
) -> None:
    """补跑历史某一天不许把批次窗口缩回去。"""
    room_id = await make_room(db_session, "回补")
    batch = await seed_batch(db_session, room_id)
    context = context_for(one_startup(STARTED_AT, COMPLIED_AT))
    await append_day(
        db_session, context, room_id=room_id, day=DAY, timezone=SHANGHAI
    )
    reached = batch.window_end
    await append_day(
        db_session,
        context,
        room_id=room_id,
        day=DAY - timedelta(days=5),
        timezone=SHANGHAI,
    )
    assert batch.window_end == reached
