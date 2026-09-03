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

    async def ensure_group(self, target: StreamGroup) -> None:
        del target

    async def ack(self, target: StreamGroup, entry_id: str) -> None:
        del target
        self.acked.append(entry_id)


def _consumer(
    stream: _Stream, database: object, mode: str, dimensions: int
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
            parse_timeout_s=30.0,
        ),
        options=ConsumerOptions(target=TARGET),
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
        _entry(ingest_queue.new_message(document_id, uuid.uuid4()).to_fields())
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
        _entry(ingest_queue.new_message(document_id, uuid.uuid4()).to_fields())
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
        _entry(ingest_queue.new_message(document_id, uuid.uuid4()).to_fields())
    )
    assert stream.acked == []
    assert await _status(db_sessions, document_id) == "parsing"


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
                ingest_queue.new_message(document_id, uuid.uuid4()).to_fields()
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
        async def ack(self, target: StreamGroup, entry_id: str) -> None:
            del target, entry_id
            raise RuntimeError("Redis 此刻不可达")

    consumer = _consumer(_Broken(), _Database(db_sessions), "ok", db_dimensions)
    await consumer._handle(
        _entry(ingest_queue.new_message(document_id, uuid.uuid4()).to_fields())
    )
    assert await _status(db_sessions, document_id) == "ready"
