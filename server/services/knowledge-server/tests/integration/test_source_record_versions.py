"""同一来源记录保留历史引用，只有完整新版本能替换当前资料。"""

import hashlib
import uuid

import pytest
from integration.conftest import DbStack
from integration.test_ingest_pipeline import _deps as parsing_deps
from integration.test_ingest_pipeline import _pair, _Source
from integration.test_reembedding_worker import (
    LocalEmbedder,
    Sessions,
    local_space,
    unchanged,
)
from integration.test_sync_api import (
    _deps,
    _item,
    _Pull,
    _source_row,
    _Store,
    _Stream,
)
from sqlalchemy import select, text

from knowledge_server.apps.knowledge.models import (
    KnowledgeChunk,
    KnowledgeDocument,
)
from knowledge_server.apps.knowledge.schemas.reembedding import (
    ReembeddingStartIn,
)
from knowledge_server.apps.knowledge.services import reembedding, sync_service
from knowledge_server.apps.knowledge.services.ingest_pipeline import ingest
from knowledge_server.apps.knowledge.services.reembedding_worker import (
    ReembeddingSteps,
)
from knowledge_server.settings import API_PREFIX

pytestmark = pytest.mark.requires_postgres


async def _sync(
    sessions: Sessions,
    source: uuid.UUID,
    row: tuple[str, str],
    sinks: tuple[_Store, _Stream],
) -> sync_service.SyncOutcome:
    body, key = row
    return await sync_service.sync_source(
        sessions,
        _deps(_Pull(pages=[((_item(body, key),), None)]), *sinks),
        source,
    )


async def _documents(stack: DbStack, base: uuid.UUID) -> list[str]:
    response = await stack.client.get(
        f"{API_PREFIX}/documents", params={"base_id": str(base)}
    )
    assert response.status_code == 200
    return [doc["id"] for doc in response.json()["data"]["items"]]


async def _ingest(
    sessions: Sessions, doc: uuid.UUID, payload: str, model: LocalEmbedder
) -> uuid.UUID:
    args = parsing_deps(
        _Source(payload.encode()), model, _pair(model.dimensions)
    )
    async with sessions() as session:
        row = await session.get(KnowledgeDocument, doc)
        assert row is not None
        generation = row.ingest_generation
    try:
        assert await ingest(sessions, args, doc, generation) == "ready"
    finally:
        args.pool.shutdown()
    async with sessions() as session:
        chunk = await session.scalar(
            select(KnowledgeChunk.id).where(KnowledgeChunk.document_id == doc)
        )
        assert chunk is not None
        return chunk


async def _by_hash(
    sessions: Sessions, source: uuid.UUID, payload: str
) -> tuple[uuid.UUID, uuid.UUID]:
    async with sessions() as session:
        row = await session.scalar(
            select(KnowledgeDocument).where(
                KnowledgeDocument.source_id == source,
                KnowledgeDocument.content_hash
                == hashlib.sha256(payload.encode()).hexdigest(),
            )
        )
        assert row is not None
        return row.base_id, row.id


async def test_same_record_publishes_only_the_ready_version_and_keeps_citations(
    db_stack: DbStack,
    db_sessions: Sessions,
    db_dimensions: int,
) -> None:
    source = await _source_row(db_sessions)
    sinks = _Store(), _Stream()
    first = await _sync(
        db_sessions, source, ("第一版的原文快照。", "row-17"), sinks
    )
    assert first.registered == 1
    base, old = await _by_hash(db_sessions, source, "第一版的原文快照。")
    old_chunk = await _ingest(
        db_sessions, old, "第一版的原文快照。", LocalEmbedder(db_dimensions)
    )
    quote_url = f"{API_PREFIX}/knowledge-bases/{base}/chunks/{old_chunk}"
    quoted = (await db_stack.client.get(quote_url)).json()["data"]["text"]
    assert quoted
    updated = await _sync(
        db_sessions, source, ("第二版的新文字。", "row-17"), sinks
    )
    assert updated.registered == 1
    _, new = await _by_hash(db_sessions, source, "第二版的新文字。")
    assert old != new
    assert await _documents(db_stack, base) == [str(old)]
    duplicate = await _sync(
        db_sessions, source, ("第二版的新文字。", "row-17"), sinks
    )
    assert duplicate.skipped == 1
    assert len(sinks[1].sent) == 2
    await _ingest(
        db_sessions, new, "第二版的新文字。", LocalEmbedder(db_dimensions)
    )
    assert await _documents(db_stack, base) == [str(new)]
    old_quote = await db_stack.client.get(quote_url)
    assert old_quote.status_code == 200
    assert old_quote.json()["data"]["text"] == quoted
    async with db_sessions() as session:
        entries = (
            await session.execute(
                text(
                    "SELECT record_key,current_document_id,pending_document_id "
                    "FROM knowledge.kb_source_records WHERE source_id=:id"
                ),
                {"id": source},
            )
        ).all()
    assert entries == [("row-17", new, None)]
    assert len(sinks[0].objects) == 2


async def test_reactivating_an_archive_after_switch_reuses_its_original_chunks(
    db_stack: DbStack, db_sessions: Sessions, db_dimensions: int
) -> None:
    source = await _source_row(db_sessions)
    sinks = _Store(), _Stream()
    initial = LocalEmbedder(db_dimensions)
    await _sync(db_sessions, source, ("First original text.", "row"), sinks)
    base, old = await _by_hash(db_sessions, source, "First original text.")
    chunk = await _ingest(db_sessions, old, "First original text.", initial)
    await _sync(db_sessions, source, ("Replacement material.", "row"), sinks)
    _, latest = await _by_hash(db_sessions, source, "Replacement material.")
    await _ingest(db_sessions, latest, "Replacement material.", initial)
    target = local_space(db_dimensions, "other-provider")
    other = LocalEmbedder(db_dimensions)
    other.space = target
    async with db_sessions() as session:
        info = await reembedding.preview(session, base, target)
        command = reembedding.StartRequest(
            base,
            uuid.uuid4(),
            "new-index",
            ReembeddingStartIn(
                target_space_id=target.identity,
                expected_revision=info.content_revision,
            ),
        )
        job = await reembedding.start(session, command, target)
    worker = ReembeddingSteps(db_sessions, other, unchanged, 128)
    await worker.run_one()
    await worker.run_one()
    await _sync(db_sessions, source, ("First original text.", "row"), sinks)
    assert await _documents(db_stack, base) == [str(latest)]
    restored = await _ingest(db_sessions, old, "First original text.", other)
    assert restored == chunk
    assert await _documents(db_stack, base) == [str(old)]
    async with db_sessions() as session:
        assert await session.scalar(
            text(
                "SELECT EXISTS(SELECT FROM knowledge.kb_generation_embeddings "
                "WHERE generation_id=:job AND chunk_id=:chunk)"
            ),
            {"job": job.id, "chunk": chunk},
        )


async def test_shared_content_stays_current_for_other_stable_records(
    db_stack: DbStack, db_sessions: Sessions, db_dimensions: int
) -> None:
    one = await _source_row(db_sessions)
    sinks = _Store(), _Stream()
    content = "Shared source material."
    await _sync(db_sessions, one, (content, "same-ID"), sinks)
    base, shared = await _by_hash(db_sessions, one, content)
    await _ingest(db_sessions, shared, content, LocalEmbedder(db_dimensions))
    response = await db_stack.client.post(
        f"{API_PREFIX}/knowledge-bases/{base}/sources",
        json={
            "name": "second",
            "kind": "platform",
            "config": {"path": "/api/v1/platform/second"},
        },
    )
    two = uuid.UUID(response.json()["data"]["id"])
    assert (
        await _sync(db_sessions, two, (content, "same-ID"), sinks)
    ).skipped == 1
    await _sync(db_sessions, one, ("Updated for one.", "same-ID"), sinks)
    _, new = await _by_hash(db_sessions, one, "Updated for one.")
    await _ingest(
        db_sessions, new, "Updated for one.", LocalEmbedder(db_dimensions)
    )
    assert set(await _documents(db_stack, base)) == {str(shared), str(new)}
    async with db_sessions() as session:
        rows = await session.execute(
            text(
                "SELECT source_id,current_document_id "
                "FROM knowledge.kb_source_records "
                "WHERE source_id IN (:one,:two)"
            ),
            {"one": one, "two": two},
        )
        assert dict(rows.all()) == {one: new, two: shared}


async def test_repeated_sync_recovers_an_unclaimed_version(
    db_stack: DbStack, db_sessions: Sessions, db_dimensions: int
) -> None:
    source = await _source_row(db_sessions)
    sinks = _Store(), _Stream()
    model = LocalEmbedder(db_dimensions)
    await _sync(db_sessions, source, ("Original notes.", "k"), sinks)
    base, old = await _by_hash(db_sessions, source, "Original notes.")
    await _ingest(db_sessions, old, "Original notes.", model)
    await _sync(db_sessions, source, ("Updated notes.", "k"), sinks)
    _, candidate = await _by_hash(db_sessions, source, "Updated notes.")
    async with db_sessions() as session:
        await session.execute(
            text(
                "UPDATE knowledge.kb_documents "
                "SET updated_at=now()-interval '1 day' "
                "WHERE id=:id"
            ),
            {"id": candidate},
        )
    seen = await _sync(db_sessions, source, ("Updated notes.", "k"), sinks)
    assert seen.skipped == 1
    assert len(sinks[1].sent) == 3
    async with db_sessions() as session:
        row = await session.get(KnowledgeDocument, candidate)
        assert row is not None
        assert row.ingest_generation is not None
    assert await _documents(db_stack, base) == [str(old)]
    await _ingest(db_sessions, candidate, "Updated notes.", model)
    assert await _documents(db_stack, base) == [str(candidate)]
