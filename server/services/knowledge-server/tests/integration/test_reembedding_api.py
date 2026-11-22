"""管理权限、跨库隔离及已确认任务的 HTTP 契约。"""

import uuid

import httpx
import pytest
from integration.conftest import DbStack, HeaderFactory
from integration.test_reembedding_worker import local_space
from sqlalchemy import select

from knowledge_server.apps.knowledge.api import reembeddings
from knowledge_server.apps.knowledge.models import (
    KnowledgeBase,
    ReembeddingAudit,
)
from knowledge_server.apps.knowledge.services.embedding import EmbeddingSpace
from knowledge_server.settings import API_PREFIX

pytestmark = pytest.mark.requires_postgres


@pytest.fixture
async def libraries(
    db_stack: DbStack, db_dimensions: int
) -> tuple[uuid.UUID, uuid.UUID]:
    db_stack.app.dependency_overrides[reembeddings.target] = (
        lambda: local_space(db_dimensions)
    )
    async with db_stack.sessions() as session:
        first = KnowledgeBase(name="验收库", owner_id="qa")
        other = KnowledgeBase(name="独立库", owner_id="qa")
        session.add_all([first, other])
        await session.commit()
        return first.id, other.id


async def test_manage_api_binds_approval_and_reports_conflicts(
    libraries: tuple[uuid.UUID, uuid.UUID],
    db_client: httpx.AsyncClient,
    sign: HeaderFactory,
) -> None:
    path = f"{API_PREFIX}/knowledge-bases/{libraries[0]}/reembeddings"
    reader = sign(["knowledge:use"])
    manager = sign(["knowledge:manage"])
    assert (
        await db_client.post(path + ":preview", json={}, headers=reader)
    ).status_code == 403
    preview = (
        await db_client.post(path + ":preview", json={}, headers=manager)
    ).json()["data"]
    assert preview["can_start"]
    body = {
        "target_space_id": preview["target_space_id"],
        "expected_revision": preview["content_revision"],
    }
    headers = {**manager, "Idempotency-Key": "approved-job"}
    stale = await db_client.post(
        path,
        json={**body, "expected_revision": body["expected_revision"] + 1},
        headers=headers,
    )
    assert (stale.status_code, stale.json()["code"]) == (409, 42330)
    new = await db_client.post(path, json=body, headers=headers)
    assert new.status_code == 202, new.text
    job = new.json()["data"]["id"]
    assert new.headers["location"].endswith(job)
    assert (await db_client.post(path, json=body, headers=headers)).json()[
        "data"
    ]["id"] == job
    other_key = {**manager, "Idempotency-Key": "distinct"}
    conflict = await db_client.post(path, json=body, headers=other_key)
    assert (conflict.status_code, conflict.json()["code"]) == (409, 42331)
    mismatch = await db_client.post(
        path, json={**body, "target_space_id": "8" * 64}, headers=headers
    )
    assert mismatch.json()["code"] == 42334


async def test_job_details_cancellation_and_audit_are_scoped_to_the_library(
    libraries: tuple[uuid.UUID, uuid.UUID],
    db_stack: DbStack,
    sign: HeaderFactory,
    db_dimensions: int,
) -> None:
    base_id, other_id = libraries
    db_client = db_stack.client
    reader = sign(["knowledge:use"])
    manager = sign(["knowledge:manage"])
    path = f"{API_PREFIX}/knowledge-bases/{base_id}/reembeddings"
    created = await db_client.post(
        path,
        json={
            "target_space_id": local_space(db_dimensions).identity,
            "expected_revision": 0,
        },
        headers={**manager, "Idempotency-Key": "access-and-audit"},
    )
    assert created.status_code == 202
    job = created.json()["data"]["id"]
    cross = await db_client.get(
        f"{API_PREFIX}/knowledge-bases/{other_id}/reembeddings/{job}",
        headers=manager,
    )
    assert cross.status_code == 404
    assert (
        await db_client.get(path + "/" + job, headers=reader)
    ).status_code == 403
    assert (
        await db_client.post(
            path + "/" + job + ":cancel", json={}, headers=reader
        )
    ).status_code == 403
    cancelled = await db_client.post(
        path + "/" + job + ":cancel", json={}, headers=manager
    )
    assert cancelled.json()["data"]["status"] == "cancelled"
    listed = (
        await db_client.get(
            path, headers=manager, params={"page": 1, "size": 1}
        )
    ).json()["data"]
    assert listed["items"][0]["id"] == job
    await _assert_actor(db_stack, job, manager["X-Auth-User-Id"])


async def _assert_actor(db_stack: DbStack, job: str, actor: str) -> None:
    async with db_stack.sessions() as session:
        events = (
            await session.scalars(
                select(ReembeddingAudit).where(
                    ReembeddingAudit.job_id == uuid.UUID(job)
                )
            )
        ).all()
        assert {event.action for event in events} == {"requested", "cancelled"}
        for event in events:
            assert str(event.actor_id) == actor
            assert event.source_ip == "127.0.0.1"
            assert event.trace_id


async def test_physical_index_width_controls_preview_and_start(
    libraries: tuple[uuid.UUID, uuid.UUID],
    db_stack: DbStack,
    db_dimensions: int,
) -> None:
    wrong = EmbeddingSpace("b" * 64, "其他维数", db_dimensions + 1)
    db_stack.app.dependency_overrides[reembeddings.target] = lambda: wrong
    path = f"{API_PREFIX}/knowledge-bases/{libraries[0]}/reembeddings"
    response = await db_stack.client.post(path + ":preview", json={})
    assert response.status_code == 200
    preview = response.json()["data"]
    assert not preview["can_start"]
    assert "维数" in preview["note"]
    started = await db_stack.client.post(
        path,
        headers={"Idempotency-Key": "mismatched-width"},
        json={
            "expected_revision": preview["content_revision"],
            "target_space_id": wrong.identity,
        },
    )
    assert started.status_code == 409
    assert started.json()["code"] == 42332
