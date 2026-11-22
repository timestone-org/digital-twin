"""丢失提交应答时用真实持久任务核对启动及取消。"""

import asyncio
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from itertools import product

import httpx
import pytest
from integration.conftest import DbStack, HeaderFactory
from integration.test_reembedding_worker import local_space
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge.api import reembeddings
from knowledge_server.apps.knowledge.crud import knowledge_base
from knowledge_server.apps.knowledge.models import (
    KnowledgeBase,
    ReembeddingAudit,
    ReembeddingJob,
)
from knowledge_server.apps.knowledge.schemas.reembedding import (
    ReembeddingStartIn,
)
from knowledge_server.apps.knowledge.services import reembedding
from knowledge_server.apps.knowledge.services.embedding import EmbeddingSpace
from knowledge_server.deps import get_session
from knowledge_server.settings import API_PREFIX, Settings
from lib.db import Database

pytestmark = pytest.mark.requires_postgres


@dataclass
class CommitFault:
    kind: str
    is_armed: bool = False

    async def install(
        self, session: AsyncSession, patch: pytest.MonkeyPatch
    ) -> None:
        if not self.is_armed:
            return
        if self.kind == "constraint":
            self.is_armed = False
            await session.execute(
                text(
                    "CREATE TEMP TABLE kb_qa_failure "
                    "(n int UNIQUE DEFERRABLE INITIALLY DEFERRED) "
                    "ON COMMIT DROP"
                )
            )
            await session.execute(
                text("INSERT INTO kb_qa_failure VALUES (1),(1)")
            )
            return
        original = session.commit

        async def lose() -> None:
            await original()
            if self.is_armed:
                self.is_armed = False
                raise TimeoutError("synthetic lost COMMIT reply")

        patch.setattr(session, "commit", lose)


@pytest.fixture
async def receipt_database(
    db_settings: Settings,
    db_dimensions: int,
) -> AsyncIterator[tuple[Database, uuid.UUID, EmbeddingSpace]]:
    database = Database(dsn=db_settings.dsn(), search_path="knowledge")
    identity = uuid.uuid4()
    try:
        async with database.session() as session:
            session.add(
                KnowledgeBase(id=identity, name="提交应答合成库", owner_id="qa")
            )
        yield database, identity, local_space(db_dimensions)
    finally:
        async with database.session() as session:
            await knowledge_base.delete_base(session, identity)
            await session.execute(
                text(
                    "DELETE FROM knowledge.kb_reembedding_audits "
                    "WHERE base_id=:id"
                ),
                {"id": identity},
            )
        await database.dispose()


@asynccontextmanager
async def _unavailable() -> AsyncIterator[AsyncSession]:
    raise OSError("database probe unavailable")
    yield


def _fault_on_commit(
    stack: DbStack,
    database: Database,
    fault: CommitFault,
    patch: pytest.MonkeyPatch,
    target: EmbeddingSpace,
) -> None:
    async def real_session() -> AsyncIterator[AsyncSession]:
        async with database.session() as session:
            await fault.install(session, patch)
            yield session

    stack.app.dependency_overrides[reembeddings.target] = lambda: target
    stack.app.dependency_overrides[get_session] = real_session


async def _audit_is_unique(
    database: Database, identity: uuid.UUID, operation: str
) -> None:
    async with database.session() as session:
        jobs = (
            await session.scalars(
                select(ReembeddingJob).where(ReembeddingJob.base_id == identity)
            )
        ).all()
        assert len(jobs) == 1
        events = (
            await session.scalars(
                select(ReembeddingAudit.action).where(
                    ReembeddingAudit.job_id == jobs[0].id
                )
            )
        ).all()
        assert sorted(events) == (
            ["requested"]
            if operation == "start"
            else ["cancelled", "requested"]
        )


def _assert_response(
    operation: str, fault: str, first: httpx.Response, retry: httpx.Response
) -> None:
    expected = 202 if operation == "start" else 200
    assert (
        first.status_code
        == {"lost": expected, "constraint": 500, "unreachable": 503}[fault]
    ), first.text
    assert retry.status_code == expected
    if fault == "lost":
        assert first.json()["data"]["id"] == retry.json()["data"]["id"]
    elif fault == "unreachable":
        assert first.json()["code"] == 52335


@pytest.mark.parametrize(
    "case",
    list(product(("start", "cancel"), ("lost", "constraint", "unreachable"))),
)
async def test_lost_commit_reply_recovers_the_actual_durable_job(
    db_stack: DbStack,
    receipt_database: tuple[Database, uuid.UUID, EmbeddingSpace],
    sign: HeaderFactory,
    monkeypatch: pytest.MonkeyPatch,
    case: tuple[str, str],
) -> None:
    operation, fault = case
    database, identity, space = receipt_database
    headers = {**sign(["knowledge:manage"]), "Idempotency-Key": "one-operation"}
    body = {"target_space_id": space.identity, "expected_revision": 0}
    path = f"{API_PREFIX}/knowledge-bases/{identity}/reembeddings"
    injection = CommitFault(fault)
    _fault_on_commit(db_stack, database, injection, monkeypatch, space)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(
            app=db_stack.app, raise_app_exceptions=False
        ),
        base_url="http://test",
        timeout=10,
    ) as client:
        if operation == "cancel":
            created = await client.post(path, json=body, headers=headers)
            assert created.status_code == 202
            path += f"/{created.json()['data']['id']}:cancel"
            body = {}
        injection.is_armed = True
        with monkeypatch.context() as outage:
            if fault == "unreachable":
                outage.setattr(
                    db_stack.app.state.container.database,
                    "session",
                    _unavailable,
                )
            first = await client.post(path, json=body, headers=headers)
        retry = await client.post(path, json=body, headers=headers)
        _assert_response(operation, fault, first, retry)
    await _audit_is_unique(database, identity, operation)


async def test_simultaneous_starts_return_the_same_persisted_identity(
    db_settings: Settings,
    db_dimensions: int,
) -> None:
    space = local_space(db_dimensions)
    database = Database(dsn=db_settings.dsn(), search_path="knowledge")
    base, actor = uuid.uuid4(), uuid.uuid4()
    try:
        async with database.session() as session:
            session.add(KnowledgeBase(id=base, name="并发启动", owner_id="qa"))
        ready = asyncio.Barrier(2)
        command = reembedding.StartRequest(
            base,
            actor,
            "same",
            ReembeddingStartIn(
                target_space_id=space.identity, expected_revision=0
            ),
        )

        async def start() -> uuid.UUID:
            await ready.wait()
            async with database.session() as session:
                return (await reembedding.start(session, command, space)).id

        first, second = await asyncio.gather(start(), start())
        assert first == second
        async with database.session() as session:
            audits = (
                await session.scalars(
                    select(ReembeddingAudit).where(
                        ReembeddingAudit.job_id == first
                    )
                )
            ).all()
            assert len(audits) == 1
    finally:
        async with database.session() as session:
            await knowledge_base.delete_base(session, base)
            await session.execute(
                text(
                    "DELETE FROM knowledge.kb_reembedding_audits "
                    "WHERE base_id=:id"
                ),
                {"id": base},
            )
        await database.dispose()
