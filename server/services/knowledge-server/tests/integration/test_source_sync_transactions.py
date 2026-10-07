"""来源同步在事务外做 IO，取消与提交结果未知时保留正确原件归属。"""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import replace
from typing import cast

import httpx
import pytest
from integration.conftest import CommittingSession, DbStack, _NoStream
from integration.test_source_sync_failures import _create, _listed, _SyncStore
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncSession,
    async_sessionmaker,
)

from knowledge_server.deps import get_sync_sessions
from knowledge_server.settings import API_PREFIX
from lib.objectstore import ObjectStore
from lib.stream import StreamLike

pytestmark = pytest.mark.requires_postgres


def _response() -> httpx.Response:
    return httpx.Response(200, json={"data": {"items": [{"row_id": "one"}]}})


def _wire(
    stack: DbStack,
    upstream: httpx.AsyncClient,
    store: ObjectStore,
    stream: StreamLike,
) -> None:
    stack.app.state.container = replace(
        stack.app.state.container,
        platform=upstream,
        objectstore=store,
        stream=stream,
    )


class _CheckedStore(_SyncStore):
    def __init__(self, opened: list[AsyncSession]) -> None:
        super().__init__()
        self.opened = opened

    async def put_bytes(
        self, key: str, content: bytes, *, content_type: str
    ) -> None:
        assert all(not session.in_transaction() for session in self.opened)
        await super().put_bytes(key, content, content_type=content_type)

    async def delete(self, key: str) -> None:
        assert all(not session.in_transaction() for session in self.opened)
        await super().delete(key)


class _CheckedStream(_NoStream):
    def __init__(self, opened: list[AsyncSession]) -> None:
        super().__init__()
        self.opened = opened

    async def publish(self, stream: str, fields: dict[str, str]) -> str:
        assert all(not session.in_transaction() for session in self.opened)
        return await super().publish(stream, fields)


async def test_http_storage_and_publish_run_outside_transactions(
    db_stack: DbStack,
) -> None:
    _base_id, source_id = await _create(db_stack.client)
    opened: list[AsyncSession] = []

    @asynccontextmanager
    async def sessions() -> AsyncIterator[AsyncSession]:
        async with CommittingSession(db_stack.sessions) as session:
            opened.append(session)
            yield session

    def respond(_request: httpx.Request) -> httpx.Response:
        assert all(not session.in_transaction() for session in opened)
        return _response()

    store, stream = _CheckedStore(opened), _CheckedStream(opened)
    db_stack.app.dependency_overrides[get_sync_sessions] = lambda: sessions
    async with httpx.AsyncClient(
        base_url="http://platform-test", transport=httpx.MockTransport(respond)
    ) as upstream:
        _wire(
            db_stack,
            upstream,
            cast(ObjectStore, store),
            cast(StreamLike, stream),
        )
        response = await db_stack.client.post(
            f"{API_PREFIX}/sources/{source_id}:sync"
        )
        repeated = await db_stack.client.post(
            f"{API_PREFIX}/sources/{source_id}:sync"
        )
    assert response.status_code == repeated.status_code == 200
    assert len(store.objects) == len(stream.sent) == 1
    assert len(store.deleted) == 1


class _CommitThenFailSession(AsyncSession):
    should_fail_commit: bool = False

    async def commit(self) -> None:
        await super().commit()
        if self.should_fail_commit:
            raise RuntimeError("private-commit-result-unknown")


async def test_unknown_commit_keeps_the_committed_document_snapshot(
    db_stack: DbStack,
) -> None:
    base_id, source_id = await _create(db_stack.client)
    store, scope_count = _SyncStore(), 0
    maker = async_sessionmaker(
        bind=cast(AsyncConnection, db_stack.sessions.kw["bind"]),
        class_=_CommitThenFailSession,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )

    @asynccontextmanager
    async def sessions() -> AsyncIterator[AsyncSession]:
        nonlocal scope_count
        scope_count += 1
        async with CommittingSession(maker) as session:
            cast(_CommitThenFailSession, session).should_fail_commit = (
                scope_count == 2
            )
            yield session

    db_stack.app.dependency_overrides[get_sync_sessions] = lambda: sessions
    async with httpx.AsyncClient(
        base_url="http://platform-test",
        transport=httpx.MockTransport(lambda _request: _response()),
    ) as upstream:
        db_stack.app.state.container = replace(
            db_stack.app.state.container,
            platform=upstream,
            objectstore=cast(ObjectStore, store),
        )
        with pytest.raises(RuntimeError, match="private-commit-result-unknown"):
            await db_stack.client.post(f"{API_PREFIX}/sources/{source_id}:sync")
    assert len(store.objects) == 1
    assert not store.deleted
    documents = await db_stack.client.get(
        f"{API_PREFIX}/documents", params={"base_id": base_id}
    )
    assert documents.json()["data"]["total"] == 1
    saved = await _listed(db_stack.client, base_id, source_id)
    assert saved["last_error"] == ""
    assert saved["last_synced_at"] is not None


async def test_repeated_cancellation_does_not_interrupt_snapshot_cleanup(
    db_stack: DbStack,
) -> None:
    base_id, source_id = await _create(db_stack.client)
    uploaded, deleting, resume_delete = (
        asyncio.Event(),
        asyncio.Event(),
        asyncio.Event(),
    )

    class InterruptedStore(_SyncStore):
        async def put_bytes(
            self, key: str, content: bytes, *, content_type: str
        ) -> None:
            await super().put_bytes(key, content, content_type=content_type)
            uploaded.set()
            await asyncio.Event().wait()

        async def delete(self, key: str) -> None:
            deleting.set()
            await resume_delete.wait()
            await super().delete(key)

    store = InterruptedStore()
    async with httpx.AsyncClient(
        base_url="http://platform-test",
        transport=httpx.MockTransport(lambda _request: _response()),
    ) as upstream:
        db_stack.app.state.container = replace(
            db_stack.app.state.container,
            platform=upstream,
            objectstore=cast(ObjectStore, store),
        )
        task = asyncio.create_task(
            db_stack.client.post(f"{API_PREFIX}/sources/{source_id}:sync")
        )
        try:
            await uploaded.wait()
            task.cancel()
            await deleting.wait()
            task.cancel()
            resume_delete.set()
            with pytest.raises(asyncio.CancelledError):
                await task
        finally:
            resume_delete.set()
    assert not store.objects
    assert len(store.deleted) == 1
    saved = await _listed(db_stack.client, base_id, source_id)
    assert saved["last_error"] == "来源同步已取消，请重新同步"
