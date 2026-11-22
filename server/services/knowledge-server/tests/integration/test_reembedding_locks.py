"""独立 PostgreSQL 事务交错修改原文与发布代次。"""

import asyncio
import uuid
from collections.abc import Sequence

import pytest
from integration.test_reembedding_worker import (
    LocalEmbedder,
    corpus,
    local_space,
    start_job,
    unchanged,
)
from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge import crud
from knowledge_server.apps.knowledge.models import (
    KnowledgeBase,
    KnowledgeDocument,
    ReembeddingAudit,
    ReembeddingJob,
)
from knowledge_server.apps.knowledge.services.reembedding_worker import (
    ReembeddingSteps,
)
from knowledge_server.settings import Settings
from lib.db import Database
from llmcore.embedding_snapshot import EmbeddingBatch

pytestmark = pytest.mark.requires_postgres


async def _at_row_lock(
    database: Database, owner: int, task: asyncio.Task[bool]
) -> None:
    """等工作者已遇到现有行锁或已主动放弃本批。Args: database, owner, task。"""
    async with asyncio.timeout(8):
        while not task.done():
            async with database.session() as inspect:
                blocked = await inspect.scalar(
                    text("""
                    SELECT EXISTS(SELECT FROM pg_stat_activity
                                  WHERE :owner=ANY(pg_blocking_pids(pid)))
                """),
                    {"owner": owner},
                )
            if blocked:
                return
            await asyncio.sleep(0.02)


@pytest.mark.parametrize("operation", ["requeue", "delete"])
async def test_finishing_does_not_deadlock_a_document_writer(
    db_settings: Settings, db_dimensions: int, operation: str
) -> None:
    database = Database(dsn=db_settings.dsn(), search_path="knowledge")
    base, doc, _ = await corpus(database.session)
    task = None
    try:
        async with database.session() as session:
            row = await session.get(KnowledgeDocument, doc)
            assert row is not None
            row.status = "failed"
            row.embedding_deferred = True
        made = await start_job(
            database.session, base, uuid.uuid4(), local_space(db_dimensions)
        )
        steps = ReembeddingSteps(
            database.session, LocalEmbedder(db_dimensions), unchanged, 8
        )
        await steps.run_one()
        async with database.session() as writer:
            await writer.get(KnowledgeDocument, doc, with_for_update=True)
            pid = await _backend_pid(writer)
            task = asyncio.create_task(steps.run_one())
            await _at_row_lock(database, pid, task)
            if operation == "delete":
                assert await crud.document.delete_document(writer, doc) == 1
            else:
                assert (
                    await crud.document.mark_requeued(writer, doc, uuid.uuid4())
                    == 1
                )
        await task
        async with database.session() as check:
            item = await check.get(ReembeddingJob, made.id)
            assert item is not None
            assert item.status == "failed"
            current = await check.get(KnowledgeBase, base)
            assert current is not None
            assert current.active_embedding_generation_id is None
    finally:
        if task is not None:
            await asyncio.gather(task, return_exceptions=True)
        await _clean_corpus(database, base)


async def test_deleting_a_chunk_cannot_deadlock_its_shadow_vector(
    db_settings: Settings,
    db_dimensions: int,
) -> None:
    database = Database(dsn=db_settings.dsn(), search_path="knowledge")
    base, _, ids = await corpus(database.session)
    began, resume = asyncio.Event(), asyncio.Event()

    class Paused(LocalEmbedder):
        async def embed_batch(self, texts: Sequence[str]) -> EmbeddingBatch:
            began.set()
            await asyncio.wait_for(resume.wait(), 8)
            return await super().embed_batch(texts)

    task = None
    try:
        job = await start_job(
            database.session, base, uuid.uuid4(), local_space(db_dimensions)
        )
        steps = ReembeddingSteps(
            database.session, Paused(db_dimensions), unchanged, 8
        )
        task = asyncio.create_task(steps.run_one())
        await asyncio.wait_for(began.wait(), 8)
        async with database.session() as writer:
            await writer.execute(
                text(
                    "SELECT id FROM knowledge.kb_chunks WHERE id=:id FOR UPDATE"
                ),
                {"id": ids[0]},
            )
            pid = await _backend_pid(writer)
            resume.set()
            await _at_row_lock(database, pid, task)
            await writer.execute(
                text("DELETE FROM knowledge.kb_chunks WHERE id=:id"),
                {"id": ids[0]},
            )
        await task
        async with database.session() as session:
            result = await session.get(ReembeddingJob, job.id)
            assert result is not None
            assert result.status == "failed"
            assert result.completed_chunks == 0
    finally:
        resume.set()
        if task is not None:
            await asyncio.gather(task, return_exceptions=True)
        await _clean_corpus(database, base)


async def _clean_corpus(database: Database, base: uuid.UUID) -> None:
    async with database.session() as cleanup:
        await crud.knowledge_base.delete_base(cleanup, base)
        await cleanup.execute(
            delete(ReembeddingAudit).where(ReembeddingAudit.base_id == base)
        )
    await database.dispose()


async def _backend_pid(session: AsyncSession) -> int:
    result = await session.execute(text("SELECT pg_backend_pid()"))
    return int(result.scalar_one())
