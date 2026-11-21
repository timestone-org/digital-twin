"""真库核对 HVAC 自提交与长任务幂等回执的顺序。"""

import asyncio
import uuid
from collections.abc import AsyncGenerator, AsyncIterator, Awaitable, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import dataclass, replace
from datetime import UTC, datetime

import httpx
import pytest
from sqlalchemy import delete, select, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession
from unit.source_fakes import FakeAcSource, InMemoryStream

from integration.ac_model_helpers import (
    PREFIX,
    Seeded,
    SignHeaders,
    create_body,
    seed_room,
)
from lib.db import Database
from lib.idempotency import IdempotencyStore
from lib.stream import RedisStream, StreamEntry, StreamGroup
from lib.testing import InMemoryCache, deferred_commit_failure
from platform_server.app import build_app
from platform_server.apps.hvac.catalog import AC_MANAGE
from platform_server.apps.hvac.models import (
    AcDataBinding,
    AcDispatch,
    AcMetricLimit,
    AcModel,
    AcStartupBatch,
    AcStartupShard,
    AcUnit,
    Room,
    Workshop,
)
from platform_server.apps.hvac.schemas import TimeWindow
from platform_server.apps.hvac.services import (
    ac_dispatch,
    ac_model_queue,
    ac_startup_queue,
)
from platform_server.apps.hvac.services.ac_source_reader import AcSourceReader
from platform_server.apps.hvac.services.ac_startup_extract import (
    ExtractionContext,
)
from platform_server.apps.hvac.services.ac_startup_rules import ExtractionRules
from platform_server.apps.hvac.services.ac_startup_service import (
    request_rebuild,
)
from platform_server.apps.hvac.services.ac_startup_worker import (
    ConsumerOptions,
    ShardConsumer,
)
from platform_server.apps.hvac.startups import (
    BATCH_STATUS_READY,
    SHARD_STATUS_DONE,
)
from platform_server.container import Container
from platform_server.settings import Settings

pytestmark = pytest.mark.requires_postgres


@dataclass(frozen=True)
class HvacCase:
    client: httpx.AsyncClient
    database: Database
    room: Seeded

    async def model_names(self) -> list[str]:
        async with self.database.session() as session:
            names = await session.scalars(
                select(AcModel.name).where(AcModel.room_id == self.room.room_id)
            )
            return list(names.all())

    async def handoff_ids(self, field: str) -> tuple[uuid.UUID, ...]:
        async with self.database.session() as session:
            if field == "model_id":
                resources = select(AcModel.id).where(
                    AcModel.room_id == self.room.room_id
                )
            else:
                resources = select(AcStartupBatch.id).where(
                    AcStartupBatch.room_id == self.room.room_id
                )
            identities = [
                str(item) for item in await session.scalars(resources)
            ]
            rows = await session.scalars(
                select(AcDispatch.id)
                .where(AcDispatch.fields[field].astext.in_(identities))
                .order_by(AcDispatch.id)
            )
            return tuple(rows)

    async def create(self, name: str) -> httpx.Response:
        return await self.client.post(
            f"{PREFIX}/ac-models", json=create_body(self.room, name=name)
        )


async def _cleanup(session: AsyncSession, room: Seeded) -> None:
    workshop_id = await session.scalar(
        select(Room.workshop_id).where(Room.id == room.room_id)
    )
    models = await session.scalars(
        select(AcModel.id).where(AcModel.room_id == room.room_id)
    )
    batches = await session.scalars(
        select(AcStartupBatch.id).where(AcStartupBatch.room_id == room.room_id)
    )
    await session.execute(
        delete(AcDispatch).where(
            AcDispatch.fields["model_id"].astext.in_(
                [str(model) for model in models]
            )
            | AcDispatch.fields["batch_id"].astext.in_(
                [str(batch) for batch in batches]
            )
        )
    )
    units = select(AcUnit.id).where(AcUnit.room_id == room.room_id)
    for dependent in (AcDataBinding, AcMetricLimit):
        await session.execute(
            delete(dependent).where(dependent.ac_unit_id.in_(units))
        )
    for model in (AcModel, AcStartupBatch, AcUnit):
        await session.execute(
            delete(model).where(model.room_id == room.room_id)
        )
    await session.execute(delete(Room).where(Room.id == room.room_id))
    await session.execute(delete(Workshop).where(Workshop.id == workshop_id))


@pytest.fixture
async def hvac_case(
    settings: Settings, db_session: AsyncSession, sign: SignHeaders
) -> AsyncIterator[HvacCase]:
    del db_session
    app = build_app(settings)
    container = app.state.container
    assert isinstance(container, Container)
    database = container.database
    app.state.container = replace(
        container,
        stream=InMemoryStream(),
        idempotency=IdempotencyStore(
            cache=InMemoryCache(), namespace="hvac-commit-test"
        ),
    )
    async with database.session() as session:
        room = await seed_room(session)
    headers = {**sign([AC_MANAGE]), "Idempotency-Key": "hvac-commit-retry"}
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    try:
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
            headers=headers,
            timeout=10,
        ) as client:
            yield HvacCase(client, database, room)
    finally:
        async with database.session() as session:
            await _cleanup(session, room)
        await database.dispose()


def _without_commit_ack(
    database: Database, patch: pytest.MonkeyPatch
) -> Callable[[], AbstractAsyncContextManager[AsyncSession]]:
    open_session = database.session

    @asynccontextmanager
    async def lose_ack() -> AsyncGenerator[AsyncSession]:
        async with open_session() as session:
            commit = session.commit

            async def commit_then_disconnect() -> None:
                await commit()
                raise DBAPIError(
                    "COMMIT",
                    None,
                    ConnectionResetError("QA lost acknowledgement"),
                    connection_invalidated=True,
                )

            patch.setattr(session, "commit", commit_then_disconnect)
            yield session

    return lose_ack


async def test_unknown_training_commit_keeps_the_key(
    hvac_case: HvacCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    case = hvac_case
    with monkeypatch.context() as patch:
        patch.setattr(
            case.database, "session", _without_commit_ack(case.database, patch)
        )
        response = await case.create("实际已入库")
    assert await case.model_names() == ["实际已入库"]
    assert response.status_code == 503, response.text
    assert "未确认" in response.json()["message"]

    repeated = await case.create("不能再创建")
    assert repeated.status_code == 409, repeated.text
    assert "未确认" in repeated.json()["message"]
    assert await case.model_names() == ["实际已入库"]


async def test_training_confirmed_rollback_can_use_the_same_key_again(
    hvac_case: HvacCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    case = hvac_case
    with monkeypatch.context() as patch:
        patch.setattr(
            case.database,
            "session",
            deferred_commit_failure(case.database.session),
        )
        rejected = await case.create("实际回滚")
    assert rejected.status_code == 500
    assert await case.model_names() == []
    accepted = await case.create("改正后已入库")
    assert accepted.status_code == 202, accepted.text
    assert await case.model_names() == ["改正后已入库"]


async def test_a_worker_recovers_training_after_the_request_client_has_gone(
    hvac_case: HvacCase,
    redis_url: str,
    settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    case = hvac_case
    with monkeypatch.context() as patch:
        patch.setattr(
            case.database, "session", _without_commit_ack(case.database, patch)
        )
        failed = await case.create("请求结束后接力")
    assert failed.status_code == 503
    ids = await case.handoff_ids("model_id")
    assert len(ids) == 1
    await case.client.aclose()
    await case.database.dispose()

    database = Database(dsn=settings.dsn(), search_path="platform")
    try:
        await _recover_training(database, redis_url, ids)
    finally:
        await database.dispose()


async def _recover_training(
    database: Database, redis_url: str, ids: tuple[uuid.UUID, ...]
) -> None:
    target = StreamGroup(f"qa:hvac:{ids[0]}", "qa-workers", "qa-instance")
    targets = {ac_dispatch.TRAINING: target.stream}
    stream = RedisStream(url=redis_url, should_delete_on_ack=True)
    try:
        await stream.ensure_group(target)
        attempts = await asyncio.gather(
            ac_dispatch.publish_waiting(database, stream, targets, ids),
            ac_dispatch.publish_waiting(database, stream, targets, ids),
        )
        assert sorted(attempts) == [0, 1]
        assert (
            await ac_dispatch.publish_waiting(database, stream, targets, ids)
            == 0
        )
        entries = await stream.read_group(target, count=4, block_ms=10)
        assert len(entries) == 1
        message = ac_model_queue.decode(entries[0].fields)
        assert message is not None
        assert message.dispatch_id == ids[0]
        assert message.traceparent
        await _receive_twice(database, stream, target, entries[0])
    finally:
        await stream.close()


async def _receive_twice(
    database: Database,
    stream: RedisStream,
    target: StreamGroup,
    first: StreamEntry,
) -> None:
    ran = 0
    started = asyncio.Event()
    finish = asyncio.Event()

    async def can_run(_session: AsyncSession) -> bool:
        return True

    async def perform() -> None:
        nonlocal ran
        ran += 1
        started.set()
        await finish.wait()

    async def receive(entry: StreamEntry) -> bool:
        message = ac_model_queue.decode(entry.fields)
        assert message is not None
        return await ac_dispatch.process_delivery(
            database,
            ac_dispatch.ConsumerDelivery(
                message.dispatch_id,
                entry.entry_id,
                entry.fields,
                ac_dispatch.TRAINING,
                3.0,
            ),
            can_run,
            perform,
        )

    await stream.publish(target.stream, first.fields)
    duplicate = await stream.read_group(target, count=4, block_ms=10)
    assert len(duplicate) == 1
    active = asyncio.create_task(receive(first))
    try:
        await asyncio.wait_for(started.wait(), timeout=5)
        assert await receive(duplicate[0])
        assert not await receive(first)
    finally:
        finish.set()
        assert await active
    assert await receive(first)
    for entry in (first, duplicate[0]):
        await stream.ack(target, entry.entry_id)
    assert ran == 1


async def test_a_worker_recovers_all_shards_from_the_committed_batch(
    hvac_case: HvacCase,
    redis_url: str,
) -> None:
    window = TimeWindow(
        start=datetime(2026, 2, 5, tzinfo=UTC),
        end=datetime(2026, 3, 5, tzinfo=UTC),
    )
    async with hvac_case.database.session() as session:
        plan = await request_rebuild(
            session,
            room_id=hvac_case.room.room_id,
            window=window,
            rules=ExtractionRules(),
            timezone="Asia/Shanghai",
        )
    ids = await hvac_case.handoff_ids("batch_id")
    assert len(ids) == 2
    stream = RedisStream(url=redis_url, should_delete_on_ack=True)
    target = StreamGroup(f"qa:hvac:{ids[0]}", "qa-shards", "qa-instance")
    targets = {ac_dispatch.SHARD: target.stream}
    try:
        await stream.ensure_group(target)
        assert (
            await ac_dispatch.publish_waiting(
                hvac_case.database, stream, targets, ids
            )
            == 2
        )
        assert (
            await ac_dispatch.publish_waiting(
                hvac_case.database, stream, targets, ids
            )
            == 0
        )
        entries = await stream.read_group(target, count=4, block_ms=10)
        assert len(entries) == 2
        messages = [ac_startup_queue.decode(entry.fields) for entry in entries]
        assert all(
            message is not None and message.batch_id == plan.batch.id
            for message in messages
        )
        assert {
            message.month for message in messages if message is not None
        } == {"2026-02", "2026-03"}
        await _finalize_replayed_shards(
            hvac_case.database, stream, target, entries, plan.batch.id
        )
    finally:
        await stream.close()


async def _finalize_replayed_shards(
    database: Database,
    stream: RedisStream,
    target: StreamGroup,
    entries: list[StreamEntry],
    batch_id: uuid.UUID,
) -> None:
    async with database.session() as session:
        await session.execute(
            update(AcStartupShard)
            .where(AcStartupShard.batch_id == batch_id)
            .values(status=SHARD_STATUS_DONE)
        )
    reader = AcSourceReader(source=FakeAcSource(), timezone="Asia/Shanghai")
    consumer = ShardConsumer(
        database=database,
        stream=stream,
        context=ExtractionContext(reader, ExtractionRules(), 100),
        options=ConsumerOptions(target, 1, 10, 30_000, 5),
    )
    for entry in entries:
        await consumer._handle(entry)
    async with database.session() as session:
        batch = await session.get(AcStartupBatch, batch_id)
        assert batch is not None
        assert batch.status == BATCH_STATUS_READY
        assert batch.is_current


async def test_dispatch_worker_finishes_its_tick_before_drain(
    hvac_case: HvacCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    worker = ac_dispatch.AcDispatchWorker(
        hvac_case.database, InMemoryStream(), {}
    )
    pruned = asyncio.Event()
    prune = worker._prune
    prune_count = 0

    async def report_pruned() -> None:
        nonlocal prune_count
        await prune()
        prune_count += 1
        pruned.set()

    monkeypatch.setattr(worker, "_prune", report_pruned)
    task = asyncio.create_task(worker.run())
    try:
        await asyncio.wait_for(pruned.wait(), timeout=5)
    finally:
        worker.stop()
        await worker.drain(timeout_s=5)
        await asyncio.wait_for(task, timeout=5)
    assert prune_count == 1


async def test_expired_consumer_cannot_acknowledge_the_live_entry(
    hvac_case: HvacCase, redis_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    case = hvac_case
    with monkeypatch.context() as patch:
        patch.setattr(
            case.database, "session", _without_commit_ack(case.database, patch)
        )
        failed = await case.create("消费接力")
    assert failed.status_code == 503
    ids = await case.handoff_ids("model_id")
    assert len(ids) == 1
    target = StreamGroup(f"qa:hvac:{ids[0]}", "qa-workers", "first")
    stream = RedisStream(url=redis_url, should_delete_on_ack=True)
    try:
        await stream.ensure_group(target)
        assert (
            await ac_dispatch.publish_waiting(
                case.database,
                stream,
                {ac_dispatch.TRAINING: target.stream},
                ids,
            )
            == 1
        )
        entries = await stream.read_group(target, count=2, block_ms=10)
        assert len(entries) == 1
        await _exercise_expired_ownership(
            case.database, stream, target, entries[0]
        )
    finally:
        await stream.close()


async def _exercise_expired_ownership(
    database: Database,
    stream: RedisStream,
    target: StreamGroup,
    first: StreamEntry,
) -> None:
    reached = asyncio.Queue[str]()
    finish_first = asyncio.Event()
    completed = 0

    async def first_action() -> None:
        reached.put_nowait("first")
        await finish_first.wait()

    async def interrupted_action() -> None:
        reached.put_nowait("second")
        await asyncio.Event().wait()

    async def final_action() -> None:
        nonlocal completed
        completed += 1

    first_task = asyncio.create_task(
        _consume_for_test(database, first, first_action)
    )
    assert await asyncio.wait_for(reached.get(), 5) == "first"
    await _expire_dispatch_execution(database, first)
    second = await _reclaim_entry(
        stream, replace(target, consumer="second"), first
    )
    second_task = asyncio.create_task(
        _consume_for_test(database, second, interrupted_action)
    )
    try:
        assert await asyncio.wait_for(reached.get(), 5) == "second"
        finish_first.set()
        old_owner_ack = await first_task
        if old_owner_ack:
            await stream.ack(target, first.entry_id)
        assert not old_owner_ack
    finally:
        second_task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await second_task

    await _complete_reclaimed(database, stream, target, second, final_action)
    assert completed == 1


async def _complete_reclaimed(
    database: Database,
    stream: RedisStream,
    target: StreamGroup,
    interrupted: StreamEntry,
    action: Callable[[], Awaitable[None]],
) -> None:
    """接替已中断的消费者，完成并确认同一条消息。"""
    await _expire_dispatch_execution(database, interrupted)
    last_target = replace(target, consumer="last")
    last = await _reclaim_entry(stream, last_target, interrupted)
    assert await _consume_for_test(database, last, action)
    await stream.ack(last_target, last.entry_id)


async def _consume_for_test(
    database: Database,
    entry: StreamEntry,
    action: Callable[[], Awaitable[None]],
) -> bool:
    message = ac_model_queue.decode(entry.fields)
    assert message is not None

    async def is_runnable(_session: AsyncSession) -> bool:
        return True

    return await ac_dispatch.process_delivery(
        database,
        ac_dispatch.ConsumerDelivery(
            message.dispatch_id,
            entry.entry_id,
            entry.fields,
            ac_dispatch.TRAINING,
            3.0,
        ),
        is_runnable,
        action,
    )


async def _expire_dispatch_execution(
    database: Database, entry: StreamEntry
) -> None:
    message = ac_model_queue.decode(entry.fields)
    assert message is not None
    async with database.session() as session:
        await session.execute(
            update(AcDispatch)
            .where(AcDispatch.id == message.dispatch_id)
            .values(execution_until=datetime(2000, 1, 1, tzinfo=UTC))
        )


async def _reclaim_entry(
    stream: RedisStream, target: StreamGroup, original: StreamEntry
) -> StreamEntry:
    claimed = await stream.claim_stale(target, min_idle_ms=0, count=1)
    assert len(claimed) == 1
    assert claimed[0].entry_id == original.entry_id
    return claimed[0]
