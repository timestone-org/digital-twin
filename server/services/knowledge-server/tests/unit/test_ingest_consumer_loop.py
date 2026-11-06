"""消费循环本身：单条收场出错时循环不死，那条留给重新认领。"""

import uuid
from collections.abc import Callable
from typing import cast

import pytest

from knowledge_server.apps.knowledge.services import (
    ingest_queue,
    ingest_worker,
)
from knowledge_server.apps.knowledge.services.ingest_pipeline import IngestDeps
from knowledge_server.apps.knowledge.services.ingest_worker import (
    ConsumerOptions,
    IngestConsumer,
)
from lib.db import Database
from lib.stream import StreamEntry, StreamGroup, StreamLike

TARGET = StreamGroup(stream="test-ingest", group="test", consumer="one")


class _Stream:
    """按批吐消息，吐完就停掉消费者。"""

    def __init__(self, entries: list[StreamEntry]) -> None:
        self.entries = entries
        self.acked: list[str] = []
        self.stop: Callable[[], None] = lambda: None

    async def ensure_group(self, target: StreamGroup) -> None:
        del target

    async def claim_stale(
        self, target: StreamGroup, *, min_idle_ms: int, count: int
    ) -> list[StreamEntry]:
        del target, min_idle_ms, count
        return []

    async def read_group(
        self, target: StreamGroup, *, count: int, block_ms: int
    ) -> list[StreamEntry]:
        del target, count, block_ms
        entry = self.entries.pop(0)
        if not self.entries:
            self.stop()
        return [entry]

    async def touch(self, target: StreamGroup, entry_id: str) -> bool:
        del target, entry_id
        return True

    async def ack_if_owned(self, target: StreamGroup, entry_id: str) -> bool:
        del target
        self.acked.append(entry_id)
        return True


class _Database:
    """只提供一个不会被调用的 `session` 入口。"""

    session = None


def _entry(entry_id: str, document_id: uuid.UUID) -> StreamEntry:
    message = ingest_queue.new_message(document_id, uuid.uuid4(), uuid.uuid4())
    return StreamEntry(entry_id=entry_id, fields=message.to_fields())


def _consumer(stream: _Stream) -> IngestConsumer:
    consumer = IngestConsumer(
        stream=cast("StreamLike", stream),
        # 管线与失败落库都被替换，这两样不会被碰到
        database=cast("Database", _Database()),
        deps=cast("IngestDeps", object()),
        options=ConsumerOptions(target=TARGET),
    )
    stream.stop = consumer.stop
    return consumer


class _FailingOnce:
    """摄取与记失败都连不上库：只有第一份文档这样。"""

    def __init__(self, broken: uuid.UUID) -> None:
        self.broken = broken

    async def ingest(
        self,
        session: object,
        deps: object,
        document_id: uuid.UUID,
        generation: uuid.UUID | None,
    ) -> None:
        del session, deps, generation
        if document_id == self.broken:
            raise ConnectionError("数据库连不上")

    async def mark_failed(
        self, session: object, document_id: uuid.UUID, reason: str
    ) -> None:
        del session, reason
        if document_id == self.broken:
            raise ConnectionError("数据库连不上")


async def test_the_loop_survives_when_recording_the_failure_also_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """⚠ 循环一死，进程还活着、探针还绿，而此后每份文档都停在 pending。"""
    broken, healthy = uuid.uuid4(), uuid.uuid4()
    doubles = _FailingOnce(broken)
    monkeypatch.setattr(ingest_worker, "ingest", doubles.ingest)
    monkeypatch.setattr(ingest_worker, "mark_failed", doubles.mark_failed)
    stream = _Stream([_entry("1-0", broken), _entry("2-0", healthy)])

    await _consumer(stream).run()

    assert stream.acked == ["2-0"], "落不了终态的那条要留给重新认领"
