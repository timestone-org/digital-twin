"""整库重嵌的预检绑定、幂等及审计在同一数据库事务内。"""

import uuid

import pytest
from integration.conftest import DbStack
from integration.test_reembedding_worker import (
    LocalEmbedder,
    Sessions,
    corpus,
    local_space,
    start_job,
    unchanged,
)
from sqlalchemy import select

from knowledge_server.apps.knowledge.models import (
    KnowledgeBase,
    ReembeddingAudit,
    ReembeddingJob,
)
from knowledge_server.apps.knowledge.schemas.reembedding import (
    ReembeddingStartIn,
)
from knowledge_server.apps.knowledge.services import reembedding
from knowledge_server.apps.knowledge.services.reembedding_worker import (
    ReembeddingSteps,
)

pytestmark = pytest.mark.requires_postgres


async def test_repeated_start_and_cancel_keep_one_job_and_one_audit(
    db_stack: DbStack,
    db_dimensions: int,
) -> None:
    space = local_space(db_dimensions)
    async with db_stack.sessions() as db_session:
        base = KnowledgeBase(name="合成空库", owner_id="qa")
        db_session.add(base)
        await db_session.flush()
        actor = uuid.uuid4()
        preview = await reembedding.preview(db_session, base.id, space)
        assert preview.can_start
        assert preview.total_chunks == 0
        request = reembedding.StartRequest(
            base.id,
            actor,
            "same-intent",
            ReembeddingStartIn(
                target_space_id=space.identity,
                expected_revision=preview.content_revision,
            ),
        )
        first = await reembedding.start(db_session, request, space)
        again = await reembedding.start(db_session, request, space)
        assert first == again
        assert first.status == "pending"
        stopped = await reembedding.cancel(db_session, base.id, first.id, actor)
        assert stopped.status == "cancelled"
        assert (
            await reembedding.cancel(db_session, base.id, first.id, actor)
            == stopped
        )
        events = await db_session.scalars(
            select(ReembeddingAudit.action)
            .where(ReembeddingAudit.job_id == first.id)
            .order_by(ReembeddingAudit.created_at, ReembeddingAudit.id)
        )
        assert sorted(events) == ["cancelled", "requested"]


async def test_preexisting_job_with_wrong_physical_width_keeps_the_active_index(
    db_sessions: Sessions, db_dimensions: int
) -> None:
    base, _, _ = await corpus(db_sessions)
    job = await start_job(
        db_sessions, base, uuid.uuid4(), local_space(db_dimensions)
    )
    async with db_sessions() as session:
        row = await session.get(ReembeddingJob, job.id)
        assert row is not None
        row.target_dimensions = db_dimensions + 1
    worker = ReembeddingSteps(
        db_sessions, LocalEmbedder(db_dimensions), unchanged, 3
    )
    assert await worker.run_one()
    async with db_sessions() as session:
        result = await reembedding.read(session, base, job.id)
        library = await session.get(KnowledgeBase, base)
        assert library is not None
        assert library.active_embedding_generation_id is None
        assert result.status == "failed"
        assert result.completed_chunks == 0
        assert result.error_message is not None
        assert "维数" in result.error_message
