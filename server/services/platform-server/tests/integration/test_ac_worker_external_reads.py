"""抽取消费者读取 EMS 时归还业务事务，写回前检查批次仍有效。"""

from dataclasses import replace
from typing import cast

import pytest
from conftest import AppContext
from sqlalchemy import select
from unit.source_fakes import InMemoryStream

from integration import test_ac_startup_daily as daily
from integration import test_ac_startup_lifecycle as shard
from integration.hvac_external_observer import observe_read
from lib.db import Database
from lib.stream import StreamGroup
from platform_server.apps.hvac.models import (
    AcStartupBatch,
    AcStartupEpisode,
    AcStartupShard,
)
from platform_server.apps.hvac.services.ac_daily_queue import DailyMessage
from platform_server.apps.hvac.services.ac_daily_worker import (
    DailyConsumer,
    DailyConsumerOptions,
)
from platform_server.apps.hvac.services.ac_startup_service import (
    fail_shard,
    request_rebuild,
)
from platform_server.apps.hvac.services.ac_startup_worker import (
    ConsumerOptions,
    ShardConsumer,
)
from platform_server.apps.hvac.startups import BATCH_STATUS_FAILED

pytestmark = pytest.mark.requires_postgres
TARGET = StreamGroup(stream="qa", group="qa", consumer="qa")


@pytest.mark.parametrize("is_superseded", [False, True])
async def test_daily_read_revalidates_the_current_batch(
    app_context: AppContext,
    stream: InMemoryStream,
    monkeypatch: pytest.MonkeyPatch,
    is_superseded: bool,
) -> None:
    room = await daily.make_room(app_context.session, "增量隔离")
    batch = await daily.seed_batch(app_context.session, room)
    await app_context.session.commit()
    context = daily.context_for(
        daily.one_startup(daily.STARTED_AT, daily.COMPLIED_AT)
    )
    consumer = DailyConsumer(
        database=cast(Database, app_context.sessions),
        stream=stream,
        context=context,
        options=DailyConsumerOptions(TARGET, 1, 5, 1000, 30, daily.SHANGHAI),
    )

    async def retire() -> None:
        async with app_context.sessions.session() as changed:
            old = await changed.get(AcStartupBatch, batch.id)
            assert old is not None
            old.is_current = False

    with observe_read(
        monkeypatch,
        context.reader,
        "fetch_samples",
        retire if is_superseded else None,
    ) as counts:
        outcome = await consumer._run_one(DailyMessage(room, daily.DAY, ""))
    assert counts == [0]
    assert outcome.outcome == (
        daily.DAILY_RUN_SKIPPED if is_superseded else daily.DAILY_RUN_APPENDED
    )
    await app_context.session.refresh(batch)
    assert batch.episode_count == (0 if is_superseded else 1)


@pytest.mark.parametrize("is_stopped", [False, True])
async def test_shard_revalidates_its_batch_after_source_read(
    app_context: AppContext,
    stream: InMemoryStream,
    monkeypatch: pytest.MonkeyPatch,
    is_stopped: bool,
) -> None:
    room = await shard.make_room(app_context.session, "分片隔离")
    plan = await request_rebuild(
        app_context.session,
        room_id=room,
        window=shard.WINDOW,
        rules=shard.RULES,
        timezone="Asia/Shanghai",
    )
    context = shard.context_for(shard.crossing_rows())
    consumer = ShardConsumer(
        database=cast(Database, app_context.sessions),
        stream=stream,
        context=context,
        options=ConsumerOptions(TARGET, 1, 5, 1000, 30),
    )

    async def stop_batch() -> None:
        async with app_context.sessions.session() as changed:
            batch = await changed.get(AcStartupBatch, plan.batch.id)
            assert batch is not None
            batch.status = BATCH_STATUS_FAILED

    with observe_read(
        monkeypatch,
        context.reader,
        "fetch_samples",
        stop_batch if is_stopped else None,
    ) as counts:
        await consumer._run_one(plan.messages[0])
    assert counts == [0]
    written = list(
        await app_context.session.scalars(
            select(AcStartupEpisode).where(
                AcStartupEpisode.batch_id == plan.batch.id
            )
        )
    )
    assert len(written) == (0 if is_stopped else 1)


async def test_late_failure_does_not_replace_a_completed_shard(
    app_context: AppContext, stream: InMemoryStream
) -> None:
    room = await shard.make_room(app_context.session, "迟到读失败")
    plan = await request_rebuild(
        app_context.session,
        room_id=room,
        window=shard.WINDOW,
        rules=shard.RULES,
        timezone="Asia/Shanghai",
    )
    consumer = ShardConsumer(
        database=cast(Database, app_context.sessions),
        stream=stream,
        context=shard.context_for(shard.crossing_rows()),
        options=ConsumerOptions(TARGET, 1, 5, 1000, 30),
    )
    message = plan.messages[0]
    await consumer._run_one(message)
    await consumer._record_failure(message, reason="另一份已在途的读取失败")
    async with app_context.sessions.session() as read:
        batch = await read.get(AcStartupBatch, plan.batch.id)
        status = await read.scalar(
            select(AcStartupShard.status).where(
                AcStartupShard.batch_id == plan.batch.id,
                AcStartupShard.month == message.month,
            )
        )
        assert batch is not None
        assert batch.status == "running"
        assert status == "done"


@pytest.mark.parametrize(
    ("before", "after"),
    [("done", "done"), ("pending", "skipped"), ("failed", "failed")],
)
async def test_legacy_stream_delivery_preserves_a_shards_terminal_state(
    app_context: AppContext, stream: InMemoryStream, before: str, after: str
) -> None:
    room = await shard.make_room(app_context.session, "旧信封重投")
    plan = await request_rebuild(
        app_context.session,
        room_id=room,
        window=shard.WINDOW,
        rules=shard.RULES,
        timezone=daily.SHANGHAI,
    )
    context = shard.context_for(shard.crossing_rows())
    consumer = ShardConsumer(
        database=cast(Database, app_context.sessions),
        stream=stream,
        context=context,
        options=ConsumerOptions(TARGET, 1, 5, 1000, 30),
    )
    message = plan.messages[0]
    if before == "done":
        await consumer._run_one(message)
    elif before == "failed":
        async with app_context.sessions.session() as write:
            await fail_shard(write, message, reason="原分片失败")
    async with app_context.sessions.session() as write:
        row = await write.get(AcStartupBatch, plan.batch.id)
        assert row is not None
        row.status = BATCH_STATUS_FAILED
    fields = replace(message, dispatch_id=None).to_fields()
    assert "dispatch_id" not in fields
    tag = await stream.publish(TARGET.stream, fields)
    [entry] = await stream.read_group(TARGET, count=1, block_ms=1)
    await consumer._handle(entry)
    assert stream.acked == [f"{TARGET.stream}:{tag}"]
    async with app_context.sessions.session() as read:
        stored = await read.scalar(
            select(AcStartupShard).where(
                AcStartupShard.batch_id == plan.batch.id,
                AcStartupShard.month == message.month,
            )
        )
        assert stored is not None
        assert stored.status == after
        if before == "failed":
            assert stored.error == "原分片失败"
