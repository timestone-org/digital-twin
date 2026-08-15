"""批次生命周期打真实 Postgres：分片、跨月、幂等、原子切换与清理。

⚠ 最要紧的一条是跨月：一次开机跨在月界上时必须**恰好被抽出一次**。读不越界
它会消失，越界了不按归属过滤它会出现两次——两种错法都不会报错。
"""

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Protocol

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.hvac.crud import (
    ac_startup_episode_crud,
    ac_startup_shard_crud,
)
from platform_server.apps.hvac.models import (
    AcDataBinding,
    AcMetricLimit,
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
    run_shard,
)
from platform_server.apps.hvac.services.ac_startup_rules import ExtractionRules
from platform_server.apps.hvac.services.ac_startup_service import (
    request_rebuild,
)
from platform_server.apps.hvac.startups import (
    OUTCOME_USABLE,
    SHARD_STATUS_DONE,
    SHARD_STATUS_PENDING,
)
from platform_server.stream import StreamEntry


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


async def test_a_rebuild_only_enqueues_and_never_extracts(
    db_session: AsyncSession,
) -> None:
    """⚠ API 角色永不跑重任务：入队这一步不许产生任何事件行。"""
    room_id = await make_room(db_session, "入队")
    plan = await request_rebuild(
        db_session, room_id=room_id, window=WINDOW, rules=RULES
    )
    assert [message.month for message in plan.messages] == [
        "2026-01",
        "2026-02",
    ]
    assert plan.batch.shard_total == 2
    assert plan.batch.is_current is False
    assert (
        await ac_startup_episode_crud.list_by_batch(db_session, plan.batch.id)
        == []
    )
    shards = await ac_startup_shard_crud.list_by_batch(
        db_session, plan.batch.id
    )
    assert [shard.status for shard in shards] == [
        SHARD_STATUS_PENDING,
        SHARD_STATUS_PENDING,
    ]


async def test_an_episode_crossing_a_month_is_extracted_exactly_once(
    db_session: AsyncSession,
) -> None:
    """⚠ 跨月的那次开机必须恰好抽出一次，起始与达标时刻都对得上。"""
    room_id = await make_room(db_session, "跨月")
    plan = await request_rebuild(
        db_session, room_id=room_id, window=WINDOW, rules=RULES
    )
    context = context_for(crossing_rows())
    for message in plan.messages:
        await run_shard(db_session, context, message)
    found = await ac_startup_episode_crud.list_by_batch(
        db_session, plan.batch.id
    )
    assert len(found) == 1
    assert found[0].started_at == STARTED_AT
    assert found[0].complied_at == COMPLIED_AT
    assert found[0].duration_minutes == 30
    assert found[0].outcome == OUTCOME_USABLE


async def test_the_january_shard_reads_past_its_own_month(
    db_session: AsyncSession,
) -> None:
    """1 月那片要向后多读到 2 月，才判得出跨月这次到底有没有达标。"""
    room_id = await make_room(db_session, "越界")
    plan = await request_rebuild(
        db_session, room_id=room_id, window=WINDOW, rules=RULES
    )
    context = context_for(crossing_rows())
    await run_shard(db_session, context, plan.messages[0])
    reader = context.reader
    assert isinstance(reader, StubReader)
    start, end = reader.windows[0]
    # 向前 12 小时（数全停时长）、向后 100 分钟（判达标上限）
    assert start == datetime(2025, 12, 31, 12, 0, tzinfo=UTC)
    assert end == datetime(2026, 2, 1, 1, 40, tzinfo=UTC)


async def test_the_batch_is_on_disk_before_the_plan_is_handed_back(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """⚠ 计划交出去之前，批次与分片必须已经落盘。

    投递跑在响应发出的那一刻，而 FastAPI 把「发响应」放在 yield 依赖的退出栈
    **里面**（`Response.__call__` 发完就地 await 后台任务）——那时
    `get_session` 还没提交。消费者于是会先于提交读到消息，`run_shard` 看见
    「批次不存在」，那一片被当成迟到消息跳过：线上两轮全史重算都恰好卡在最早
    的两个月（2022-12、2023-01），日志时刻显示它们在建批次后 56ms 就「跑完」
    了，而那两行分片的 updated_at 至今还是播种时刻。
    """
    room_id = await make_room(db_session, "先落盘")
    commits: list[str] = []
    committing = db_session.commit

    async def counted_commit() -> None:
        commits.append("commit")
        await committing()

    monkeypatch.setattr(db_session, "commit", counted_commit)
    await request_rebuild(
        db_session, room_id=room_id, window=WINDOW, rules=RULES
    )
    assert commits == ["commit"]


async def test_the_february_shard_sees_the_start_but_does_not_write_it(
    db_session: AsyncSession,
) -> None:
    """2 月那片看得见 1 月的起机，但不归它写——否则同一次开机会有两份。"""
    room_id = await make_room(db_session, "归属")
    plan = await request_rebuild(
        db_session, room_id=room_id, window=WINDOW, rules=RULES
    )
    context = context_for(crossing_rows())
    run = await run_shard(db_session, context, plan.messages[1])
    assert run.episode_count == 0


async def test_replaying_a_message_writes_no_duplicate(
    db_session: AsyncSession,
) -> None:
    """队列是 at-least-once：同一条消息重放，事件与进度都不该翻倍。"""
    room_id = await make_room(db_session, "重放")
    plan = await request_rebuild(
        db_session, room_id=room_id, window=WINDOW, rules=RULES
    )
    context = context_for(crossing_rows())
    for _ in range(3):
        await run_shard(db_session, context, plan.messages[0])
    found = await ac_startup_episode_crud.list_by_batch(
        db_session, plan.batch.id
    )
    assert len(found) == 1
    counts = await ac_startup_shard_crud.count_by_status(
        db_session, plan.batch.id
    )
    assert counts[SHARD_STATUS_DONE] == 1


async def test_a_shard_persists_the_idle_minutes_it_counted(
    db_session: AsyncSession,
) -> None:
    """⚠ 分片写事件走的是 Core 路径的取值表，漏一列不会报错。

    状态机数出来的全停时长（AC_MODEL_DESIGN §2.5）如果停在那张表外面，
    蓄热特征就永远是 NaN——训练照跑、指标照出，只是少了一个特征，
    而没有任何地方会说起这件事。
    """
    room_id = await make_room(db_session, "蓄热")
    plan = await request_rebuild(
        db_session, room_id=room_id, window=WINDOW, rules=RULES
    )
    for message in plan.messages:
        await run_shard(db_session, context_for(crossing_rows()), message)
    episodes = await ac_startup_episode_crud.list_by_batch(
        db_session, plan.batch.id
    )
    assert [item.idle_minutes for item in episodes] == [40]
