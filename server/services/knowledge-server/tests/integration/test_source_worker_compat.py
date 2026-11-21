"""混合 worker 中来源版本使用独立消费流，持久候选能从早期完成状态接续。"""

import uuid
from datetime import timedelta

import pytest
from integration.conftest import DbStack
from integration.test_reembedding_worker import (
    LocalEmbedder,
    Sessions,
    unchanged,
)
from integration.test_source_record_versions import (
    _by_hash,
    _documents,
    _ingest,
    _sync,
)
from integration.test_sync_api import _source_row, _Store, _Stream
from sqlalchemy import text

from knowledge_server.apps.knowledge.models import KnowledgeDocument
from knowledge_server.apps.knowledge.services import (
    document_service,
    ingest_queue,
    source_recovery,
)
from knowledge_server.apps.knowledge.services.reembedding_worker import (
    ReembeddingConsumer,
    ReembeddingSteps,
)
from lib.stream import StreamGroup
from lib.utils.timeutils import utcnow

pytestmark = pytest.mark.requires_postgres


class RecordedStream(_Stream):
    def __init__(self) -> None:
        super().__init__()
        self.names: list[str] = []

    async def publish(self, stream: str, fields: dict[str, str]) -> str:
        self.names.append(stream)
        return await super().publish(stream, fields)


async def test_source_versions_never_enter_the_legacy_worker_stream(
    db_sessions: Sessions,
) -> None:
    src = await _source_row(db_sessions)
    stream = RecordedStream()
    await _sync(db_sessions, src, ("release report", "one"), (_Store(), stream))
    assert stream.names == ["s:source-versions"]
    group = ingest_queue.source_version_group(StreamGroup("s", "g", "c"))
    assert (group.stream, group.group, group.consumer) == (
        "s:source-versions",
        "g",
        "c",
    )
    assert stream.sent[0]["traceparent"]


async def _set_candidate(
    db_sessions: Sessions,
    source: uuid.UUID,
    first: uuid.UUID,
    next_document: uuid.UUID,
    unindexed_chunk: uuid.UUID | None,
) -> None:
    async with db_sessions() as session:
        await session.execute(
            text(
                "UPDATE knowledge.kb_source_records "
                "SET current_document_id=:first,pending_document_id=:next "
                "WHERE source_id=:source"
            ),
            {"first": first, "next": next_document, "source": source},
        )
        old = await session.get(KnowledgeDocument, first)
        new = await session.get(KnowledgeDocument, next_document)
        assert old is not None
        assert new is not None
        old.source_revision_state = "current"
        new.source_revision_state = "pending"
        if unindexed_chunk is not None:
            await session.execute(
                text(
                    "DELETE FROM knowledge.kb_chunk_embeddings "
                    "WHERE chunk_id=:id"
                ),
                {"id": unindexed_chunk},
            )


@pytest.mark.parametrize("mode", ["complete", "missing", "repeat-sync"])
async def test_recovery_checks_vectors_before_publishing_a_ready_version(
    db_stack: DbStack,
    db_sessions: Sessions,
    db_dimensions: int,
    mode: str,
) -> None:
    source = await _source_row(db_sessions)
    sinks = _Store(), _Stream()
    await _sync(db_sessions, source, ("First.", "row"), sinks)
    base, first = await _by_hash(db_sessions, source, "First.")
    model = LocalEmbedder(db_dimensions)
    await _ingest(db_sessions, first, "First.", model)
    await _sync(db_sessions, source, ("Second.", "row"), sinks)
    _, next_document = await _by_hash(db_sessions, source, "Second.")
    chunk = await _ingest(db_sessions, next_document, "Second.", model)
    await _set_candidate(
        db_sessions,
        source,
        first,
        next_document,
        chunk if mode != "complete" else None,
    )
    assert await _documents(db_stack, base) == [str(first)]
    recovery = source_recovery.SourceVersionRecovery(
        db_sessions, sinks[1], StreamGroup("s:source-versions", "g", "c"), 60.0
    )
    if mode == "repeat-sync":
        await _sync(db_sessions, source, ("Second.", "row"), sinks)
    else:
        assert await recovery.run_one()
    if mode == "complete":
        assert await _documents(db_stack, base) == [str(next_document)]
        assert len(sinks[1].sent) == 2
    else:
        assert await _documents(db_stack, base) == [str(first)]
        assert len(sinks[1].sent) == 3
    async with db_sessions() as session:
        assert await session.scalar(
            text(
                "SELECT EXISTS(SELECT FROM knowledge.kb_chunks WHERE id=:chunk)"
            ),
            {"chunk": chunk},
        )


async def test_pending_source_version_is_redispatched_with_new_generation(
    db_sessions: Sessions,
) -> None:
    source = await _source_row(db_sessions)
    stream = RecordedStream()
    await _sync(db_sessions, source, ("Aged sample", "row"), (_Store(), stream))
    base, identity = await _by_hash(db_sessions, source, "Aged sample")
    async with db_sessions() as session:
        document = await session.get(KnowledgeDocument, identity)
        assert document is not None
        document.updated_at = utcnow() - timedelta(seconds=120)
    recovery = source_recovery.SourceVersionRecovery(
        db_sessions, stream, StreamGroup("s:source-versions", "g", "c"), 60.0
    )

    assert await recovery.run_one()
    assert not await recovery.run_one()
    original, redispatched = map(ingest_queue.decode, stream.sent)
    assert original is not None
    assert redispatched is not None
    assert redispatched.document_id == identity
    assert redispatched.base_id == base
    assert redispatched.generation is not None
    assert redispatched.generation != original.generation
    assert stream.names == ["s:source-versions", "s:source-versions"]


async def test_manual_reparse_of_a_source_version_uses_compatible_worker(
    db_sessions: Sessions,
) -> None:
    source = await _source_row(db_sessions)
    stream = RecordedStream()
    await _sync(
        db_sessions, source, ("Inspection report", "row"), (_Store(), stream)
    )
    _, identity = await _by_hash(db_sessions, source, "Inspection report")

    async with db_sessions() as session:
        await document_service.requeue_document(
            session, stream, StreamGroup("s", "g", "c"), identity, False
        )

    original, reparsed = map(ingest_queue.decode, stream.sent)
    assert original is not None
    assert reparsed is not None
    assert reparsed.document_id == identity
    assert reparsed.generation is not None
    assert reparsed.generation != original.generation
    assert stream.names == ["s:source-versions", "s:source-versions"]


@pytest.mark.parametrize("should_fail", [True, False])
async def test_recovery_cycle_handles_a_temporarily_unavailable_candidate_store(
    db_sessions: Sessions, db_dimensions: int, should_fail: bool
) -> None:
    attempts = 0

    async def recover() -> bool:
        nonlocal attempts
        attempts += 1
        if attempts == 1 and not should_fail:
            return True
        consumer.stop()
        if should_fail:
            raise ConnectionError("候选状态暂不可读")
        return False

    steps = ReembeddingSteps(
        db_sessions, LocalEmbedder(db_dimensions), unchanged, 4
    )
    consumer = ReembeddingConsumer(steps, recover_sources=recover)

    await consumer.run()

    assert attempts == (1 if should_fail else 2)
