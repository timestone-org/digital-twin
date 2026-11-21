"""真实提交、首个会话回执与同键重放。"""

import uuid

import httpx
import pytest
from integration.conftest import DbStack, HeaderFactory
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.chat.models import ChatSession
from knowledge_server.container import Container
from knowledge_server.deps import get_session
from knowledge_server.settings import API_PREFIX
from lib.testing import deferred_commit_failure

pytestmark = pytest.mark.requires_postgres


@pytest.mark.parametrize(
    "has_key", [False, True], ids=["ordinary", "idempotent"]
)
async def test_new_session_is_acknowledged_only_after_commit(
    db_stack: DbStack,
    sign: HeaderFactory,
    monkeypatch: pytest.MonkeyPatch,
    has_key: bool,
) -> None:
    app = db_stack.app
    container: Container = app.state.container
    monkeypatch.delitem(app.dependency_overrides, get_session, raising=False)
    original = container.database.session
    title = "commit-" + uuid.uuid4().hex
    headers = sign(["knowledge:use"])
    if has_key:
        headers["Idempotency-Key"] = str(uuid.uuid4())
    payload = {"title": title}
    url = f"{API_PREFIX}/chat-sessions"
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test", timeout=10
    ) as client:
        with monkeypatch.context() as patch:
            patch.setattr(
                container.database, "session", deferred_commit_failure(original)
            )
            rejected = await client.post(url, json=payload, headers=headers)
        statement = select(ChatSession).where(ChatSession.title == title)
        async with original() as db:
            assert await db.scalar(statement) is None
        assert rejected.status_code == httpx.codes.INTERNAL_SERVER_ERROR
        assert rejected.json()["trace_id"]
        created = await client.post(url, json=payload, headers=headers)
        assert created.status_code == httpx.codes.CREATED
        async with original() as db:
            row = await db.scalar(statement)
            assert row is not None
            assert str(row.id) == created.json()["data"]["id"]
            await db.delete(row)


async def test_lost_commit_reply_does_not_create_a_second_session(
    db_stack: DbStack, sign: HeaderFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    app = db_stack.app
    container: Container = app.state.container
    monkeypatch.delitem(app.dependency_overrides, get_session, raising=False)
    title = "ack-" + uuid.uuid4().hex
    original = AsyncSession.commit

    async def lost_ack(session: AsyncSession) -> None:
        writes_session = any(
            isinstance(row, ChatSession) and row.title == title
            for row in session.identity_map.values()
        )
        await original(session)
        if writes_session:
            raise TimeoutError("本地测试丢弃已提交事务的回执")

    headers = {**sign(["knowledge:use"]), "Idempotency-Key": str(uuid.uuid4())}
    payload = {"title": title}
    url = f"{API_PREFIX}/chat-sessions"
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test", timeout=10
    ) as client:
        with monkeypatch.context() as patch:
            patch.setattr(AsyncSession, "commit", lost_ack)
            first = await client.post(url, json=payload, headers=headers)
        second = await client.post(url, json=payload, headers=headers)
    async with container.database.session() as db:
        made = list(
            (
                await db.scalars(
                    select(ChatSession.id).where(ChatSession.title == title)
                )
            ).all()
        )
        await db.execute(delete(ChatSession).where(ChatSession.title == title))
    assert (first.status_code, second.status_code, len(made)) == (
        httpx.codes.SERVICE_UNAVAILABLE,
        httpx.codes.CONFLICT,
        1,
    )
