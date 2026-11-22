"""来源旧行、锁争用和整库重嵌与当前文档切换。"""

import asyncio
import hashlib
import uuid

import pytest
from integration.conftest import DbStack
from integration.test_ingest_pipeline import _deps, _pair, _Source
from integration.test_reembedding_worker import (
    LocalEmbedder,
    Sessions,
    local_space,
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

from knowledge_server.apps.knowledge import crud
from knowledge_server.apps.knowledge.errors import SourceSyncConflict
from knowledge_server.apps.knowledge.models import (
    KnowledgeDocument,
    KnowledgeSource,
)
from knowledge_server.apps.knowledge.schemas.reembedding import (
    ReembeddingStartIn,
)
from knowledge_server.apps.knowledge.services import reembedding
from knowledge_server.apps.knowledge.services.ingest_pipeline import (
    IngestFailed,
    ingest,
)
from knowledge_server.apps.knowledge.services.reembedding_worker import (
    ReembeddingSteps,
)
from knowledge_server.settings import API_PREFIX, Settings
from lib.db import Database

pytestmark = pytest.mark.requires_postgres


async def test_an_unidentified_legacy_snapshot_is_adopted_only_on_exact_content(
    db_sessions: Sessions,
) -> None:
    source = await _source_row(db_sessions)
    legacy = uuid.uuid4()
    async with db_sessions() as session:
        stored = await session.get(KnowledgeSource, source)
        assert stored is not None
        base = stored.base_id
        write = crud.document.DocumentWrite(
            legacy,
            base,
            source,
            "legacy-opaque-key",
            "Same title.md",
            "text/markdown",
            "legacy-opaque-key",
            6,
            hashlib.sha256(b"legacy").hexdigest(),
        )
        await crud.document.insert_document(session, write)
    sinks = _Store(), _Stream()
    await _sync(db_sessions, source, ("different", "same-title"), sinks)
    async with db_sessions() as session:
        old = await session.get(KnowledgeDocument, legacy)
        assert old is not None
        assert old.source_revision_state is None
    long_key = "旧记录" * 300
    same = await _sync(db_sessions, source, ("legacy", long_key), sinks)
    assert same.skipped == 1
    async with db_sessions() as session:
        row = await session.execute(
            text(
                "SELECT current_document_id,length(record_key_hash) "
                "FROM knowledge.kb_source_records "
                "WHERE source_id=:source AND record_key=:key"
            ),
            {"source": source, "key": long_key},
        )
        assert row.one() == (legacy, 64)
        old = await session.get(KnowledgeDocument, legacy)
        assert old is not None
        assert old.object_key == "legacy-opaque-key"


async def test_contention_rolls_back_both_mapping_and_unused_snapshot(
    db_settings: Settings,
) -> None:
    database = Database(dsn=db_settings.dsn(), search_path="knowledge")
    base = None
    try:
        source = await _source_row(database.session)
        sinks = _Store(), _Stream()
        await _sync(database.session, source, ("Original bytes.", "key"), sinks)
        base, doc = await _by_hash(database.session, source, "Original bytes.")
        async with database.session() as writer:
            await writer.get(KnowledgeDocument, doc, with_for_update=True)
            async with asyncio.timeout(8):
                with pytest.raises(SourceSyncConflict):
                    await _sync(
                        database.session,
                        source,
                        ("Updated bytes.", "key"),
                        sinks,
                    )
        assert len(sinks[0].objects) == 1
        async with database.session() as session:
            row = await session.execute(
                text(
                    "SELECT current_document_id,pending_document_id "
                    "FROM knowledge.kb_source_records WHERE source_id=:id"
                ),
                {"id": source},
            )
            assert row.one() == (doc, None)
        assert (
            await _sync(
                database.session, source, ("Updated bytes.", "key"), sinks
            )
        ).registered == 1
    finally:
        if base is not None:
            async with database.session() as session:
                await crud.knowledge_base.delete_base(session, base)
        await database.dispose()


async def test_complete_reembedding_can_publish_a_deferred_source_update(
    db_stack: DbStack, db_sessions: Sessions, db_dimensions: int
) -> None:
    src = await _source_row(db_sessions)
    sinks = _Store(), _Stream()
    await _sync(db_sessions, src, ("The initial report.", "key"), sinks)
    base, old = await _by_hash(db_sessions, src, "The initial report.")
    original = await _ingest(
        db_sessions, old, "The initial report.", LocalEmbedder(db_dimensions)
    )
    await _sync(db_sessions, src, ("The revised report.", "key"), sinks)
    _, candidate = await _by_hash(db_sessions, src, "The revised report.")
    target = local_space(db_dimensions, "new-provider")
    other = LocalEmbedder(db_dimensions)
    other.space = target
    deps = _deps(_Source(b"The revised report."), other, _pair(db_dimensions))
    try:
        with pytest.raises(IngestFailed):
            await ingest(db_sessions, deps, candidate)
    finally:
        deps.pool.shutdown()
    assert await _documents(db_stack, base) == [str(old)]
    async with db_sessions() as session:
        preview = await reembedding.preview(session, base, target)
        assert preview.can_start
        assert preview.total_documents == 2
        command = reembedding.StartRequest(
            base,
            uuid.uuid4(),
            "recover-source",
            ReembeddingStartIn(
                target_space_id=target.identity,
                expected_revision=preview.content_revision,
            ),
        )
        job = await reembedding.start(session, command, target)
    worker = ReembeddingSteps(db_sessions, other, unchanged, 128)
    await worker.run_one()
    await worker.run_one()
    assert await _documents(db_stack, base) == [str(candidate)]
    async with db_sessions() as session:
        assert (
            await reembedding.read(session, base, job.id)
        ).status == "succeeded"
    quote = await db_stack.client.get(
        f"{API_PREFIX}/knowledge-bases/{base}/chunks/{original}"
    )
    assert quote.status_code == 200
