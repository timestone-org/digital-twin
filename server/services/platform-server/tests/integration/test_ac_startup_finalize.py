"""批次收尾打真实 Postgres：原子切换、失败隔离、人工排除与清理。

⚠ 绝不先删后算：一片失败时上一批次必须一动不动地继续服务，页面看到的是完整
的旧数据而不是半份新数据。
"""

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Protocol, cast

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.hvac.crud import (
    ac_startup_batch_crud,
    ac_startup_shard_crud,
)
from platform_server.apps.hvac.errors import TimeRangeInvalid
from platform_server.apps.hvac.models import (
    AcDataBinding,
    AcMetricLimit,
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
from platform_server.apps.hvac.services.ac_startup_extract import (
    ExtractionContext,
    load_bound_units,
    run_shard,
)
from platform_server.apps.hvac.services.ac_startup_queue import (
    ShardMessage,
    publish_shards,
)
from platform_server.apps.hvac.services.ac_startup_rules import ExtractionRules
from platform_server.apps.hvac.services.ac_startup_service import (
    fail_shard,
    finalize_if_complete,
    request_rebuild,
)
from platform_server.apps.hvac.startups import (
    BATCH_STATUS_FAILED,
    BATCH_STATUS_READY,
    SHARD_STATUS_FAILED,
)
from platform_server.stream import StreamEntry, StreamGroup, StreamLike


class RecordingStream(Protocol):
    """conftest 的 `stream` fixture 形状。

    ⚠ 不从 `tests.conftest` 导入：`tests` 这个包名在 workspace 里被每个服务各
    占一份，跨服务解析到谁全看 sys.path 顺序。
    """

    entries: list[StreamEntry]


RULES = ExtractionRules()
SERIAL = "K11"
SOURCE_OBJECT = "KTStartData_K11"
# 抽取区间：1 月与 2 月两片
WINDOW = TimeWindow(
    start=datetime(2026, 1, 1, tzinfo=UTC), end=datetime(2026, 3, 1, tzinfo=UTC)
)
# 跨月的那次开机：1 月 31 日 23:40 起机，2 月 1 日 00:10 达标
STARTED_AT = datetime(2026, 1, 31, 23, 40, tzinfo=UTC)
COMPLIED_AT = datetime(2026, 2, 1, 0, 10, tzinfo=UTC)


class StubReader(AcSourceReader):
    """替掉取数的读取面，其余装配照旧。"""

    def __init__(self, rows: Sequence[SourceRow]) -> None:
        self.rows = list(rows)
        self.windows: list[tuple[datetime, datetime]] = []
        self.asked: list[tuple[str, int, int]] = []

    async def fetch_samples(
        self,
        *,
        source_object: str,
        columns: Sequence[str],
        window: TimeWindow,
        row_limit: int,
    ) -> list[SourceRow]:
        self.asked.append((source_object, len(columns), row_limit))
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


def crossing_rows() -> list[SourceRow]:
    """一段跨月的数据：全停 40 分钟 → 起机 → 跨过月界后达标。"""
    rows: list[SourceRow] = []
    cursor = STARTED_AT - timedelta(minutes=40)
    while cursor < STARTED_AT:
        rows.append(row(cursor, celsius=28.0, frequency=0.0))
        cursor += timedelta(minutes=1)
    while cursor < COMPLIED_AT:
        rows.append(row(cursor, celsius=27.0, frequency=40.0))
        cursor += timedelta(minutes=1)
    while cursor < COMPLIED_AT + timedelta(minutes=30):
        rows.append(row(cursor, celsius=24.0, frequency=40.0))
        cursor += timedelta(minutes=1)
    return rows


async def make_room(session: AsyncSession, label: str) -> uuid.UUID:
    """建一个车间、房间、空调、绑定与达标范围，返回房间 id。

    Args: session, label。
    """
    workshop = Workshop(name=f"{label}车间{uuid.uuid4().hex[:8]}")
    session.add(workshop)
    await session.flush()
    room = Room(workshop_id=workshop.id, name=f"{label}房")
    session.add(room)
    await session.flush()
    unit = AcUnit(
        room_id=room.id, serial=f"{SERIAL}-{label}", name=f"{label}机"
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


def context_for(rows: Sequence[SourceRow]) -> ExtractionContext:
    """一份跑分片用的上下文。

    Args: rows。
    """
    return ExtractionContext(
        reader=StubReader(rows), rules=RULES, max_rows=100000
    )


async def test_a_batch_becomes_current_only_after_every_shard_is_done(
    db_session: AsyncSession,
) -> None:
    """还没跑完就切换，页面会看到半份数据——那比看到旧数据危险得多。"""
    room_id = await make_room(db_session, "半份")
    plan = await request_rebuild(
        db_session, room_id=room_id, window=WINDOW, rules=RULES
    )
    context = context_for(crossing_rows())
    await run_shard(db_session, context, plan.messages[0])
    assert await finalize_if_complete(db_session, plan.batch.id) is None
    assert await ac_startup_batch_crud.find_current(db_session, room_id) is None
    await run_shard(db_session, context, plan.messages[1])
    finished = await finalize_if_complete(db_session, plan.batch.id)
    assert finished is not None
    assert finished.status == BATCH_STATUS_READY
    assert finished.shard_done == 2
    assert finished.episode_count == 1
    current = await ac_startup_batch_crud.find_current(db_session, room_id)
    assert current is not None
    assert current.id == plan.batch.id


async def test_finalizing_twice_does_not_redo_the_swap(
    db_session: AsyncSession,
) -> None:
    """两个 worker 同时跑完最后两片时，收尾只能生效一次。"""
    room_id = await make_room(db_session, "并发收尾")
    plan = await request_rebuild(
        db_session, room_id=room_id, window=WINDOW, rules=RULES
    )
    context = context_for(crossing_rows())
    for message in plan.messages:
        await run_shard(db_session, context, message)
    assert await finalize_if_complete(db_session, plan.batch.id) is not None
    assert await finalize_if_complete(db_session, plan.batch.id) is None


async def test_a_failed_shard_leaves_the_previous_batch_serving(
    db_session: AsyncSession,
) -> None:
    """⚠ 一片失败只让新批次判失败，上一批次一动不动，页面照常显示完整数据。"""
    room_id = await make_room(db_session, "失败")
    first = await request_rebuild(
        db_session, room_id=room_id, window=WINDOW, rules=RULES
    )
    context = context_for(crossing_rows())
    for message in first.messages:
        await run_shard(db_session, context, message)
    await finalize_if_complete(db_session, first.batch.id)

    second = await request_rebuild(
        db_session, room_id=room_id, window=WINDOW, rules=RULES
    )
    await run_shard(db_session, context, second.messages[0])
    await ac_startup_shard_crud.mark(
        db_session,
        await _shard_of(db_session, second.batch.id, "2026-02"),
        status=SHARD_STATUS_FAILED,
        error="外部数据源不可用",
    )
    failed = await finalize_if_complete(db_session, second.batch.id)
    assert failed is not None
    assert failed.status == BATCH_STATUS_FAILED
    current = await ac_startup_batch_crud.find_current(db_session, room_id)
    assert current is not None
    assert current.id == first.batch.id


async def _shard_of(
    session: AsyncSession, batch_id: uuid.UUID, month: str
) -> object:
    """取一片，给失败标记用。

    Args: session, batch_id, month。
    """
    shards = await ac_startup_shard_crud.list_by_batch(session, batch_id)
    return next(shard for shard in shards if shard.month == month)


async def test_unmatched_exclusions_are_counted_on_the_batch(
    db_session: AsyncSession,
) -> None:
    """⚠ 对不上的人工排除必须报出来，否则人工判断会静默地烂掉。"""
    room_id = await make_room(db_session, "排除计数")
    db_session.add(
        AcStartupExclusion(
            room_id=room_id,
            started_at=STARTED_AT,
            reason="对得上的那条",
            excluded_by="测试员",
        )
    )
    db_session.add(
        AcStartupExclusion(
            room_id=room_id,
            started_at=STARTED_AT + timedelta(minutes=7),
            reason="参数变过之后落空的那条",
            excluded_by="测试员",
        )
    )
    await db_session.flush()
    plan = await request_rebuild(
        db_session, room_id=room_id, window=WINDOW, rules=RULES
    )
    context = context_for(crossing_rows())
    for message in plan.messages:
        await run_shard(db_session, context, message)
    finished = await finalize_if_complete(db_session, plan.batch.id)
    assert finished is not None
    assert finished.unmatched_exclusion_count == 1


async def test_finalizing_keeps_only_the_three_newest_batches(
    db_session: AsyncSession,
) -> None:
    """每个房间保留最近三个批次，更老的在收尾时一并清理。"""
    room_id = await make_room(db_session, "保留")
    context = context_for(crossing_rows())
    batch_ids: list[uuid.UUID] = []
    for index in range(4):
        plan = await request_rebuild(
            db_session, room_id=room_id, window=WINDOW, rules=RULES
        )
        # ⚠ now() 取的是事务开始时刻，同一个事务里建的批次时间会一模一样
        plan.batch.created_at = datetime(2026, 5, 1, tzinfo=UTC) + timedelta(
            days=index
        )
        batch_ids.append(plan.batch.id)
        for message in plan.messages:
            await run_shard(db_session, context, message)
        await finalize_if_complete(db_session, plan.batch.id)
    kept = await ac_startup_batch_crud.list_by_room(
        db_session, room_id, limit=10
    )
    assert [item.id for item in kept] == batch_ids[:0:-1]


async def test_a_late_message_for_a_finished_batch_is_ignored(
    db_session: AsyncSession,
) -> None:
    """批次已经收尾后迟到的那条消息不该再写一批孤儿事件。"""
    room_id = await make_room(db_session, "迟到")
    plan = await request_rebuild(
        db_session, room_id=room_id, window=WINDOW, rules=RULES
    )
    context = context_for(crossing_rows())
    for message in plan.messages:
        await run_shard(db_session, context, message)
    await finalize_if_complete(db_session, plan.batch.id)
    assert await run_shard(db_session, context, plan.messages[0]) == 0


async def test_a_message_for_a_vanished_batch_is_ignored(
    db_session: AsyncSession,
) -> None:
    """批次被清理掉之后，它的分片消息只能是空转。"""
    room_id = await make_room(db_session, "无主")
    context = context_for(crossing_rows())
    ghost = ShardMessage(
        batch_id=uuid.uuid4(),
        room_id=room_id,
        month="2026-01",
        traceparent="00-" + "0" * 32 + "-" + "0" * 16 + "-01",
    )
    assert await run_shard(db_session, context, ghost) == 0


async def test_a_room_with_no_bound_units_yields_no_episodes(
    db_session: AsyncSession,
) -> None:
    """没有一台空调绑了数据源时，这一片一分钟数据都读不到。"""
    workshop = Workshop(name=f"空房车间{uuid.uuid4().hex[:8]}")
    db_session.add(workshop)
    await db_session.flush()
    room = Room(workshop_id=workshop.id, name="空房")
    db_session.add(room)
    await db_session.flush()
    plan = await request_rebuild(
        db_session, room_id=room.id, window=WINDOW, rules=RULES
    )
    context = context_for(crossing_rows())
    assert await run_shard(db_session, context, plan.messages[0]) == 0


async def test_a_unit_without_limits_still_reports_its_frames(
    db_session: AsyncSession,
) -> None:
    """没配达标范围的空调不拖着房间：帧照出，只是永远算达标。"""
    workshop = Workshop(name=f"无范围车间{uuid.uuid4().hex[:8]}")
    db_session.add(workshop)
    await db_session.flush()
    room = Room(workshop_id=workshop.id, name="无范围房")
    db_session.add(room)
    await db_session.flush()
    unit = AcUnit(room_id=room.id, serial="K99-无范围", name="无范围机")
    db_session.add(unit)
    await db_session.flush()
    db_session.add(
        AcDataBinding(
            ac_unit_id=unit.id,
            dataset="raw_minute",
            source_object=SOURCE_OBJECT,
        )
    )
    await db_session.flush()
    units = await load_bound_units(db_session, room.id)
    assert [bound.unit.bands for bound in units] == [{}]


async def test_a_failed_shard_records_its_reason(
    db_session: AsyncSession,
) -> None:
    """失败原因要落库给人看，只留日志的话页面上什么都看不到。"""
    room_id = await make_room(db_session, "失败原因")
    plan = await request_rebuild(
        db_session, room_id=room_id, window=WINDOW, rules=RULES
    )
    await fail_shard(db_session, plan.messages[0], reason="外部数据源不可用")
    shards = await ac_startup_shard_crud.list_by_batch(
        db_session, plan.batch.id
    )
    failed = next(item for item in shards if item.month == "2026-01")
    assert failed.status == SHARD_STATUS_FAILED
    assert failed.error == "外部数据源不可用"


async def test_a_very_long_failure_reason_is_trimmed(
    db_session: AsyncSession,
) -> None:
    """原因超长时截断，否则会撞上分片表的 CHECK 而把失败本身也弄丢。"""
    room_id = await make_room(db_session, "超长原因")
    plan = await request_rebuild(
        db_session, room_id=room_id, window=WINDOW, rules=RULES
    )
    await fail_shard(db_session, plan.messages[0], reason="错" * 900)
    shards = await ac_startup_shard_crud.list_by_batch(
        db_session, plan.batch.id
    )
    failed = next(item for item in shards if item.month == "2026-01")
    assert failed.error is not None
    assert len(failed.error) == 500


async def test_an_empty_window_is_rejected_before_a_batch_exists(
    db_session: AsyncSession,
) -> None:
    """⚠ 零片的批次收尾时「全跑完了」当场成立，会带着 0 条事件切成当前批次，
    把这个房间的数据从页面上抹掉。空区间必须在建批次之前就拒掉。"""
    room_id = await make_room(db_session, "空区间")
    empty = TimeWindow(start=WINDOW.start, end=WINDOW.start)
    with pytest.raises(TimeRangeInvalid):
        await request_rebuild(
            db_session, room_id=room_id, window=empty, rules=RULES
        )


async def test_publishing_a_plan_puts_every_shard_on_the_stream(
    db_session: AsyncSession, stream: object
) -> None:
    """入队要把每一片都投出去，少一片就少跑一个月。"""
    room_id = await make_room(db_session, "投递")
    plan = await request_rebuild(
        db_session, room_id=room_id, window=WINDOW, rules=RULES
    )
    published = await publish_shards(
        cast(StreamLike, stream),
        target=StreamGroup(stream="s", group="g", consumer="c"),
        messages=list(plan.messages),
    )
    assert len(published) == 2
    entries = cast(RecordingStream, stream).entries
    assert [item.fields["month"] for item in entries] == [
        "2026-01",
        "2026-02",
    ]
    assert all("traceparent" in item.fields for item in entries)
