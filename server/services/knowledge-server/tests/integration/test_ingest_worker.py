"""摄取消费者的三种收场：跑完 / 没救了 / 此刻拿不到。打真库。

⚠ 三种收场三种做法，而搞混的代价都不小：
- 「此刻拿不到」也确认的话，一次对象存储抖动会把那份文档永久判死；
- 「没救了」不确认的话，一份解不动的文档会被无限认领重投，占满 worker；
- 读不懂的消息不确认的话，它会永远卡在待处理列表里。
"""

import asyncio
import uuid
from collections.abc import Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import pytest

from knowledge_server.apps.knowledge import crud
from knowledge_server.apps.knowledge.services import ingest_queue
from knowledge_server.apps.knowledge.services.indexing import build_indexes
from knowledge_server.apps.knowledge.services.ingest_pipeline import IngestDeps
from knowledge_server.apps.knowledge.services.ingest_worker import (
    ConsumerOptions,
    IngestConsumer,
)
from knowledge_server.apps.knowledge.services.parsing import RawItem
from knowledge_server.apps.knowledge.services.sources import (
    UPLOAD_KIND,
    SourceUnavailable,
)
from lib.stream import StreamEntry, StreamGroup

pytestmark = pytest.mark.requires_postgres

TARGET = StreamGroup(stream="s", group="g", consumer="c")
BODY = b"# title\nbody\n"


@dataclass(frozen=True)
class _Source:
    """按开关决定给原件、给「没了」、还是给「此刻拿不到」。"""

    mode: str
    kind: str = UPLOAD_KIND

    def config_schema(self) -> dict[str, object]:
        return {}

    async def discover(
        self, config: dict[str, object], cursor: str | None
    ) -> object:
        del config, cursor
        raise NotImplementedError

    async def fetch(self, config: dict[str, object], ref: str) -> RawItem:
        del config
        if self.mode == "gone":
            raise FileNotFoundError(ref)
        if self.mode == "flaky":
            raise SourceUnavailable("对象存储此刻不可达")
        if self.mode == "hangs":
            await asyncio.Future[None]()
        if self.mode == "slow":
            await asyncio.sleep(0.05)
        return RawItem(filename="a.md", media_type="", content=BODY)


@dataclass(frozen=True)
class _Embedder:
    """按正文长度造一条宽度正好的假向量。"""

    dimensions: int
    id: str = "fake"
    max_input_tokens: int = 512
    can_embed: bool = True

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        return [
            ([float(len(one) % 7), 1.0] + [0.0] * self.dimensions)[
                : self.dimensions
            ]
            for one in texts
        ]


class _Stream:
    """记下确认了哪些条目的假流。"""

    def __init__(self) -> None:
        self.acked: list[str] = []
        self.touched: list[str] = []

    async def ensure_group(self, target: StreamGroup) -> None:
        del target

    async def ack(self, target: StreamGroup, entry_id: str) -> None:
        del target
        self.acked.append(entry_id)

    async def ack_if_owned(self, target: StreamGroup, entry_id: str) -> bool:
        await self.ack(target, entry_id)
        return True

    async def touch(self, target: StreamGroup, entry_id: str) -> bool:
        del target
        self.touched.append(entry_id)
        return True


def _consumer(
    stream: _Stream,
    database: object,
    mode: str,
    dimensions: int,
    options: ConsumerOptions | None = None,
) -> IngestConsumer:
    return IngestConsumer(
        stream=stream,  # pyright: ignore[reportArgumentType]
        database=database,  # pyright: ignore[reportArgumentType]
        deps=IngestDeps(
            sources=(
                _Source(mode=mode),
            ),  # pyright: ignore[reportArgumentType]
            embedder=_Embedder(  # pyright: ignore[reportArgumentType]
                dimensions=dimensions
            ),
            indexes=build_indexes(dimensions),
            pool=ThreadPoolExecutor(max_workers=1),
            store=None,
            parse_timeout_s=30.0,
        ),
        options=options or ConsumerOptions(target=TARGET),
    )


def _entry(fields: Mapping[str, str]) -> StreamEntry:
    return StreamEntry(entry_id="1-0", fields=fields)


async def _document(db_sessions: object) -> uuid.UUID:
    async with db_sessions() as session:  # pyright: ignore[reportCallIssue]
        base = await crud.knowledge_base.insert_base(
            session,
            crud.knowledge_base.BaseWrite(
                name="库",
                description="",
                owner_id="t",
                embedding_model=None,
                dimensions=None,
                retrieval_strategy="hybrid",
            ),
        )
        source = await crud.source.insert_source(
            session, base.id, UPLOAD_KIND, "上传", {}
        )
        document_id = uuid.uuid4()
        await crud.document.insert_document(
            session,
            crud.document.DocumentWrite(
                document_id=document_id,
                base_id=base.id,
                source_id=source.id,
                external_ref="a.md",
                title="a.md",
                media_type="",
                object_key="k",
                byte_size=len(BODY),
                content_hash="b" * 64,
            ),
        )
    return document_id


async def _status(db_sessions: object, document_id: uuid.UUID) -> str:
    async with db_sessions() as session:  # pyright: ignore[reportCallIssue]
        row = await crud.document.get_document(session, document_id)
        return "" if row is None else row.status


class _Database:
    """把用例那条会话工厂包成 `Database` 的最小面。"""

    def __init__(self, sessions: object) -> None:
        self._sessions = sessions

    def session(self) -> object:
        return self._sessions()  # pyright: ignore[reportCallIssue]


async def test_a_finished_document_is_acked(
    db_sessions: object, db_dimensions: int
) -> None:
    document_id = await _document(db_sessions)
    stream = _Stream()
    consumer = _consumer(
        stream,
        _Database(db_sessions),
        "ok",
        db_dimensions,
    )
    await consumer._handle(
        _entry(
            ingest_queue.new_message(
                document_id, uuid.uuid4(), None
            ).to_fields()
        )
    )
    assert stream.acked == ["1-0"]
    assert await _status(db_sessions, document_id) == "ready"


async def test_a_hopeless_document_is_failed_then_acked(
    db_sessions: object, db_dimensions: int
) -> None:
    """⚠ 不确认的话，一份解不动的文档会被无限认领重投，占满 worker。"""
    document_id = await _document(db_sessions)
    stream = _Stream()
    consumer = _consumer(
        stream,
        _Database(db_sessions),
        "gone",
        db_dimensions,
    )
    await consumer._handle(
        _entry(
            ingest_queue.new_message(
                document_id, uuid.uuid4(), None
            ).to_fields()
        )
    )
    assert stream.acked == ["1-0"]
    assert await _status(db_sessions, document_id) == "failed"


async def test_a_flaky_upstream_is_left_unacked(
    db_sessions: object, db_dimensions: int
) -> None:
    """⚠ 这一档重试有意义：确认掉的话，一次对象存储抖动会把那份文档永久判死。"""
    document_id = await _document(db_sessions)
    stream = _Stream()
    consumer = _consumer(
        stream,
        _Database(db_sessions),
        "flaky",
        db_dimensions,
    )
    await consumer._handle(
        _entry(
            ingest_queue.new_message(
                document_id, uuid.uuid4(), None
            ).to_fields()
        )
    )
    assert stream.acked == []
    assert await _status(db_sessions, document_id) == "parsing"


async def test_a_running_ingest_renews_its_pending_delivery(
    db_sessions: object, db_dimensions: int
) -> None:
    document_id = await _document(db_sessions)
    stream = _Stream()
    consumer = _consumer(
        stream,
        _Database(db_sessions),
        "slow",
        db_dimensions,
        ConsumerOptions(target=TARGET, claim_idle_ms=30),
    )

    await consumer._handle(
        _entry(
            ingest_queue.new_message(
                document_id, uuid.uuid4(), None
            ).to_fields()
        )
    )

    assert stream.touched
    assert stream.acked == ["1-0"]


async def test_lost_pending_ownership_stops_without_acking(
    db_sessions: object, db_dimensions: int
) -> None:
    class _Lost(_Stream):
        async def touch(self, target: StreamGroup, entry_id: str) -> bool:
            del target, entry_id
            return False

    document_id = await _document(db_sessions)
    stream = _Lost()
    consumer = _consumer(
        stream,
        _Database(db_sessions),
        "slow",
        db_dimensions,
        ConsumerOptions(target=TARGET, claim_idle_ms=30),
    )

    await consumer._handle(
        _entry(
            ingest_queue.new_message(
                document_id, uuid.uuid4(), None
            ).to_fields()
        )
    )

    assert stream.acked == []
    assert await _status(db_sessions, document_id) == "pending"


async def test_ownership_lost_at_completion_does_not_ack_the_new_owner(
    db_sessions: object, db_dimensions: int
) -> None:
    class _AckLost(_Stream):
        async def ack_if_owned(
            self, target: StreamGroup, entry_id: str
        ) -> bool:
            del target, entry_id
            return False

    document_id = await _document(db_sessions)
    stream = _AckLost()
    consumer = _consumer(stream, _Database(db_sessions), "ok", db_dimensions)

    await consumer._handle(
        _entry(
            ingest_queue.new_message(
                document_id, uuid.uuid4(), None
            ).to_fields()
        )
    )

    assert stream.acked == []
    assert await _status(db_sessions, document_id) == "ready"


async def test_an_ingest_over_its_total_budget_is_failed_and_acked(
    db_sessions: object, db_dimensions: int
) -> None:
    document_id = await _document(db_sessions)
    stream = _Stream()
    consumer = _consumer(
        stream,
        _Database(db_sessions),
        "hangs",
        db_dimensions,
        # 真库认领也在总预算内；10 ms 在 amd64 模拟 CI 上会先掐断 savepoint，
        # 一秒足够完成认领，随后稳定地只超时在上游 hang。
        ConsumerOptions(target=TARGET, timeout_s=1.0),
    )

    await consumer._handle(
        _entry(
            ingest_queue.new_message(
                document_id, uuid.uuid4(), None
            ).to_fields()
        )
    )

    assert stream.acked == ["1-0"]
    assert await _status(db_sessions, document_id) == "failed"


async def test_an_unreadable_message_is_dropped(
    db_sessions: object, db_dimensions: int
) -> None:
    """⚠ 不确认的话它会永远卡在待处理列表里，而没有任何一处报错。"""
    stream = _Stream()
    consumer = _consumer(
        stream,
        _Database(db_sessions),
        "ok",
        db_dimensions,
    )
    await consumer._handle(_entry({"envelope_version": "0"}))
    assert stream.acked == ["1-0"]


class _Loop(_Stream):
    """跑一轮就让消费者停下来的假流。"""

    def __init__(self, entries: list[StreamEntry]) -> None:
        super().__init__()
        self._entries = entries
        self.claimed = 0
        self.read = 0

    async def claim_stale(
        self, target: StreamGroup, *, min_idle_ms: int, count: int
    ) -> list[StreamEntry]:
        del target, min_idle_ms, count
        self.claimed += 1
        return []

    async def read_group(
        self, target: StreamGroup, *, count: int, block_ms: int
    ) -> list[StreamEntry]:
        del target, count
        # ⚠ 必须真的让出一次事件循环：真的 `read_group` 是**阻塞读**，
        # 而一个从不 await 的假件会让 `run()` 空转把停止信号饿死——
        # 表现是用例挂住，看起来像死锁
        await asyncio.sleep(block_ms / 1000 / 100)
        self.read += 1
        return self._entries if self.read == 1 else []


async def test_the_loop_claims_stale_before_reading_new(
    db_sessions: object, db_dimensions: int
) -> None:
    """⚠ 某个副本跑到一半被杀掉时，它手上那条既没确认也没人管——不认领的话
    它永远卡在待处理列表里，而队列深度看着一切正常。"""
    document_id = await _document(db_sessions)
    stream = _Loop(
        [
            _entry(
                ingest_queue.new_message(
                    document_id, uuid.uuid4(), None
                ).to_fields()
            )
        ]
    )
    consumer = _consumer(stream, _Database(db_sessions), "ok", db_dimensions)

    async def stop_soon() -> None:
        await asyncio.sleep(0.05)
        consumer.stop()

    await asyncio.gather(consumer.run(), stop_soon())
    assert stream.claimed >= 1
    assert stream.acked == ["1-0"]


async def test_drain_returns_once_the_loop_is_idle(
    db_sessions: object, db_dimensions: int
) -> None:
    """闲着的循环该立刻排空，而不是干等满一个宽限期。"""
    consumer = _consumer(_Stream(), _Database(db_sessions), "ok", db_dimensions)
    started = asyncio.get_running_loop().time()
    await consumer.drain(5.0)
    assert asyncio.get_running_loop().time() - started < 1.0


async def test_a_failed_ack_is_not_fatal(
    db_sessions: object, db_dimensions: int
) -> None:
    """⚠ 确认失败不致命：这条会被别人认领回去，而消费者是幂等的。
    抛出去的话，一次 Redis 抖动会让整条消费循环停掉。"""
    document_id = await _document(db_sessions)

    class _Broken(_Stream):
        async def ack_if_owned(
            self, target: StreamGroup, entry_id: str
        ) -> bool:
            del target, entry_id
            raise RuntimeError("Redis 此刻不可达")

    consumer = _consumer(_Broken(), _Database(db_sessions), "ok", db_dimensions)
    await consumer._handle(
        _entry(
            ingest_queue.new_message(
                document_id, uuid.uuid4(), None
            ).to_fields()
        )
    )
    assert await _status(db_sessions, document_id) == "ready"


async def test_a_permanent_failure_is_not_retried_after_ack_recovers(
    db_sessions: object, db_dimensions: int
) -> None:
    """failed 是终态；ACK 抖动不能把毒文档变成自动重试。"""

    class _BrokenAck(_Stream):
        async def ack_if_owned(
            self, target: StreamGroup, entry_id: str
        ) -> bool:
            del target, entry_id
            raise RuntimeError("Redis 此刻不可达")

    document_id = await _document(db_sessions)
    message = ingest_queue.new_message(document_id, uuid.uuid4(), None)
    failed = _consumer(
        _BrokenAck(), _Database(db_sessions), "gone", db_dimensions
    )
    await failed._handle(_entry(message.to_fields()))
    assert await _status(db_sessions, document_id) == "failed"

    recovered_stream = _Stream()
    recovered = _consumer(
        recovered_stream, _Database(db_sessions), "ok", db_dimensions
    )
    await recovered._handle(_entry(message.to_fields()))

    assert recovered_stream.acked == ["1-0"]
    assert await _status(db_sessions, document_id) == "failed"


async def test_an_obsolete_generation_cannot_start_after_reparse(
    db_sessions: object, db_dimensions: int
) -> None:
    """旧消息晚到时只确认，不覆盖最新一次人工重排。"""
    document_id = await _document(db_sessions)
    old_generation = uuid.uuid4()
    current_generation = uuid.uuid4()
    async with db_sessions() as session:  # pyright: ignore[reportCallIssue]
        assert (
            await crud.document.mark_requeued(
                session, document_id, old_generation
            )
            == 1
        )
        assert (
            await crud.document.mark_requeued(
                session, document_id, current_generation
            )
            == 1
        )

    old_stream = _Stream()
    old = _consumer(old_stream, _Database(db_sessions), "ok", db_dimensions)
    await old._handle(
        _entry(
            ingest_queue.new_message(
                document_id, uuid.uuid4(), old_generation
            ).to_fields()
        )
    )
    assert old_stream.acked == ["1-0"]
    assert await _status(db_sessions, document_id) == "pending"

    current = _consumer(_Stream(), _Database(db_sessions), "ok", db_dimensions)
    await current._handle(
        _entry(
            ingest_queue.new_message(
                document_id, uuid.uuid4(), current_generation
            ).to_fields()
        )
    )
    assert await _status(db_sessions, document_id) == "ready"
