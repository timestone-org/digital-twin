"""来源同步失败说明持久化，回滚不留下未登记的原件快照。"""

import asyncio
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import UTC, datetime
from typing import cast

import httpx
import pytest
from integration.conftest import CommittingSession, DbStack, _NoStore
from sqlalchemy import update
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncSession,
    async_sessionmaker,
)

from knowledge_server.apps.knowledge import crud
from knowledge_server.deps import get_sync_sessions
from knowledge_server.settings import API_PREFIX
from lib.objectstore import ObjectStore

pytestmark = pytest.mark.requires_postgres
BASES = f"{API_PREFIX}/knowledge-bases"


class _SyncStore(_NoStore):
    async def put_bytes(
        self, key: str, content: bytes, *, content_type: str
    ) -> None:
        del content_type
        self.objects[key] = content


async def _create(
    client: httpx.AsyncClient, id_field: str = "row_id"
) -> tuple[str, str]:
    response = await client.post(BASES, json={"name": "来源同步边界测试"})
    assert response.status_code == 201
    base_id = cast(str, response.json()["data"]["id"])
    made = await client.post(
        f"{BASES}/{base_id}/sources",
        json={
            "kind": "platform",
            "name": "台账",
            "config": {
                "path": "/api/v1/platform/qa-items",
                "id_field": id_field,
            },
        },
    )
    assert made.status_code == 201
    return base_id, cast(str, made.json()["data"]["id"])


async def _listed(
    client: httpx.AsyncClient, base_id: str, source_id: str
) -> dict[str, object]:
    response = await client.get(f"{BASES}/{base_id}/sources")
    return next(
        row for row in response.json()["data"] if row["id"] == source_id
    )


@pytest.mark.parametrize(
    "body",
    [
        {"kind": "not-installed", "name": "未知类型", "config": {}},
        {"kind": "platform", "name": "缺少路径", "config": {}},
        {"kind": "platform", "name": "错误类型", "config": {"path": 123}},
        {
            "kind": "platform",
            "name": "外部URL",
            "config": {"path": "http://169.254.169.254/latest/meta-data"},
        },
    ],
    ids=["unknown-kind", "missing-path", "wrong-path-type", "external-url"],
)
async def test_invalid_source_is_rejected_before_insert(
    db_stack: DbStack, body: dict[str, object]
) -> None:
    base_id, _source_id = await _create(db_stack.client)
    rejected = await db_stack.client.post(
        f"{BASES}/{base_id}/sources", json=body
    )
    assert rejected.status_code == 400
    listing = await db_stack.client.get(f"{BASES}/{base_id}/sources")
    assert [row["kind"] for row in listing.json()["data"]] == [
        "upload",
        "platform",
    ]


async def test_sync_denial_is_saved_for_the_source_page(
    db_stack: DbStack,
) -> None:
    base_id, source_id = await _create(db_stack.client)
    async with httpx.AsyncClient(
        base_url="http://platform-test",
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(403, text="private-error")
        ),
    ) as upstream:
        db_stack.app.state.container = replace(
            db_stack.app.state.container, platform=upstream
        )
        denied = await db_stack.client.post(
            f"{API_PREFIX}/sources/{source_id}:sync"
        )
    assert denied.status_code == 403
    saved = await _listed(db_stack.client, base_id, source_id)
    assert saved["last_error"]
    assert "private-error" not in str(saved["last_error"])
    assert saved["last_synced_at"] is None


async def test_invalid_envelope_never_reports_empty_success(
    db_stack: DbStack,
) -> None:
    _base_id, source_id = await _create(db_stack.client)
    async with httpx.AsyncClient(
        base_url="http://platform-test",
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(200, json={"ok": True})
        ),
    ) as upstream:
        db_stack.app.state.container = replace(
            db_stack.app.state.container, platform=upstream
        )
        response = await db_stack.client.post(
            f"{API_PREFIX}/sources/{source_id}:sync"
        )
    assert response.status_code == 502


async def test_later_page_failure_cleans_uploaded_snapshots(
    db_stack: DbStack,
) -> None:
    base_id, source_id = await _create(db_stack.client)
    store = _SyncStore()

    def respond(request: httpx.Request) -> httpx.Response:
        if request.url.params["page"] == "1":
            return httpx.Response(
                200,
                json={
                    "code": 0,
                    "data": {
                        "items": [
                            {"row_id": f"row-{index}"} for index in range(50)
                        ]
                    },
                },
            )
        return httpx.Response(503)

    async with httpx.AsyncClient(
        base_url="http://platform-test", transport=httpx.MockTransport(respond)
    ) as upstream:
        db_stack.app.state.container = replace(
            db_stack.app.state.container,
            platform=upstream,
            objectstore=cast(ObjectStore, store),
        )
        response = await db_stack.client.post(
            f"{API_PREFIX}/sources/{source_id}:sync"
        )
    assert response.status_code == 502
    documents = await db_stack.client.get(
        f"{API_PREFIX}/documents", params={"base_id": base_id}
    )
    assert documents.json()["data"]["total"] == 0
    assert not store.objects
    assert len(store.deleted) == 50


@pytest.mark.parametrize(
    ("row", "id_field"),
    [
        ({"label": "没有标识"}, "row_id"),
        ({"row_id": None}, "row_id"),
        ({"row_id": ""}, "row_id"),
        ({"row_id": "valid"}, "configured_typo"),
    ],
    ids=["missing", "null", "empty", "wrong-field"],
)
async def test_invalid_identity_is_rejected_without_registering_a_document(
    db_stack: DbStack, row: dict[str, object], id_field: str
) -> None:
    base_id, source_id = await _create(db_stack.client, id_field)
    store = _SyncStore()
    async with httpx.AsyncClient(
        base_url="http://platform-test",
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(
                200, json={"code": 0, "data": {"items": [row]}}
            )
        ),
    ) as upstream:
        db_stack.app.state.container = replace(
            db_stack.app.state.container,
            platform=upstream,
            objectstore=cast(ObjectStore, store),
        )
        response = await db_stack.client.post(
            f"{API_PREFIX}/sources/{source_id}:sync"
        )
    assert response.status_code == 502
    assert "行标识" in response.json()["message"]
    documents = await db_stack.client.get(
        f"{API_PREFIX}/documents", params={"base_id": base_id}
    )
    assert documents.json()["data"]["total"] == 0
    assert not store.objects


async def test_valid_empty_page_still_succeeds(db_stack: DbStack) -> None:
    _base_id, source_id = await _create(db_stack.client)
    async with httpx.AsyncClient(
        base_url="http://platform-test",
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(
                200, json={"code": 0, "data": {"items": []}}
            )
        ),
    ) as upstream:
        db_stack.app.state.container = replace(
            db_stack.app.state.container, platform=upstream
        )
        response = await db_stack.client.post(
            f"{API_PREFIX}/sources/{source_id}:sync"
        )
    assert response.status_code == 200
    assert response.json()["data"] == {
        "registered": 0,
        "skipped": 0,
        "has_more": False,
    }


class _FailedCommitSession(AsyncSession):
    should_fail_commit: bool = False

    async def commit(self) -> None:
        if self.should_fail_commit:
            raise RuntimeError("private-commit-failure")
        await super().commit()


async def test_write_commit_failure_rolls_back_and_cleans_snapshots(
    db_stack: DbStack,
) -> None:
    base_id, source_id = await _create(db_stack.client)
    store = _SyncStore()
    scope_count = 0
    maker = async_sessionmaker(
        bind=cast(AsyncConnection, db_stack.sessions.kw["bind"]),
        class_=_FailedCommitSession,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )

    @asynccontextmanager
    async def failing_sessions() -> AsyncIterator[AsyncSession]:
        nonlocal scope_count
        scope_count += 1
        async with CommittingSession(maker) as session:
            cast(_FailedCommitSession, session).should_fail_commit = (
                scope_count == 2
            )
            yield session

    db_stack.app.dependency_overrides[get_sync_sessions] = (
        lambda: failing_sessions
    )
    async with httpx.AsyncClient(
        base_url="http://platform-test",
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(
                200, json={"data": {"items": [{"row_id": "one"}]}}
            )
        ),
    ) as upstream:
        db_stack.app.state.container = replace(
            db_stack.app.state.container,
            platform=upstream,
            objectstore=cast(ObjectStore, store),
        )
        with pytest.raises(RuntimeError, match="private-commit-failure"):
            await db_stack.client.post(f"{API_PREFIX}/sources/{source_id}:sync")
    assert not store.objects
    documents = await db_stack.client.get(
        f"{API_PREFIX}/documents", params={"base_id": base_id}
    )
    assert documents.json()["data"]["total"] == 0
    saved = await _listed(db_stack.client, base_id, source_id)
    assert saved["last_error"] == "来源同步未完成，请稍后重新同步"
    assert saved["last_synced_at"] is None


async def test_request_cancellation_cleans_prior_page_snapshots(
    db_stack: DbStack,
) -> None:
    base_id, source_id = await _create(db_stack.client)
    store, second_page = _SyncStore(), asyncio.Event()

    async def respond(request: httpx.Request) -> httpx.Response:
        if request.url.params["page"] == "1":
            return httpx.Response(
                200,
                json={
                    "data": {
                        "items": [{"row_id": str(index)} for index in range(50)]
                    }
                },
            )
        second_page.set()
        await asyncio.Event().wait()
        return httpx.Response(503)

    async with httpx.AsyncClient(
        base_url="http://platform-test", transport=httpx.MockTransport(respond)
    ) as upstream:
        db_stack.app.state.container = replace(
            db_stack.app.state.container,
            platform=upstream,
            objectstore=cast(ObjectStore, store),
        )
        task = asyncio.create_task(
            db_stack.client.post(f"{API_PREFIX}/sources/{source_id}:sync")
        )
        await second_page.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    assert not store.objects
    assert len(store.deleted) == 50
    documents = await db_stack.client.get(
        f"{API_PREFIX}/documents", params={"base_id": base_id}
    )
    assert documents.json()["data"]["total"] == 0
    saved = await _listed(db_stack.client, base_id, source_id)
    assert saved["last_error"] == "来源同步已取消，请重新同步"


async def test_failed_sync_keeps_the_last_success_and_owned_snapshot(
    db_stack: DbStack,
) -> None:
    base_id, source_id = await _create(db_stack.client)
    store = _SyncStore()
    async with httpx.AsyncClient(
        base_url="http://platform-test",
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(
                200, json={"data": {"items": [{"row_id": "one"}]}}
            )
        ),
    ) as upstream:
        db_stack.app.state.container = replace(
            db_stack.app.state.container,
            platform=upstream,
            objectstore=cast(ObjectStore, store),
        )
        success = await db_stack.client.post(
            f"{API_PREFIX}/sources/{source_id}:sync"
        )
    assert success.status_code == 200
    objects = dict(store.objects)
    when = datetime(2026, 10, 7, tzinfo=UTC)
    async with CommittingSession(db_stack.sessions) as session:
        await crud.source.mark_synced(session, uuid.UUID(source_id), "7", when)
    async with httpx.AsyncClient(
        base_url="http://platform-test",
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(403, text="private-error")
        ),
    ) as upstream:
        db_stack.app.state.container = replace(
            db_stack.app.state.container, platform=upstream
        )
        response = await db_stack.client.post(
            f"{API_PREFIX}/sources/{source_id}:sync"
        )
    assert response.status_code == 403
    async with CommittingSession(db_stack.sessions) as session:
        source = await crud.source.get_source(session, uuid.UUID(source_id))
        assert source is not None
        assert (source.sync_cursor, source.last_synced_at) == ("7", when)
    assert store.objects == objects
    saved = await _listed(db_stack.client, base_id, source_id)
    assert saved["last_error"] == "没有读取平台来源的权限，请联系管理员授权"


async def test_stale_sync_cannot_overwrite_a_new_success(
    db_stack: DbStack,
) -> None:
    base_id, source_id = await _create(db_stack.client)
    store = _SyncStore()
    when = datetime(2026, 10, 7, tzinfo=UTC)

    async def respond(_request: httpx.Request) -> httpx.Response:
        async with CommittingSession(db_stack.sessions) as session:
            await crud.source.mark_synced(
                session, uuid.UUID(source_id), "7", when
            )
        return httpx.Response(
            200, json={"data": {"items": [{"row_id": "stale"}]}}
        )

    async with httpx.AsyncClient(
        base_url="http://platform-test", transport=httpx.MockTransport(respond)
    ) as upstream:
        db_stack.app.state.container = replace(
            db_stack.app.state.container,
            platform=upstream,
            objectstore=cast(ObjectStore, store),
        )
        response = await db_stack.client.post(
            f"{API_PREFIX}/sources/{source_id}:sync"
        )
    assert response.status_code == 409
    assert response.json()["code"] == 42316
    assert not store.objects
    saved = await _listed(db_stack.client, base_id, source_id)
    assert saved["last_error"] == ""
    async with CommittingSession(db_stack.sessions) as session:
        source = await crud.source.get_source(session, uuid.UUID(source_id))
        assert source is not None
        assert (source.sync_cursor, source.last_synced_at) == ("7", when)


async def test_source_deleted_during_discovery_leaves_no_snapshot(
    db_stack: DbStack,
) -> None:
    _base_id, source_id = await _create(db_stack.client)
    store = _SyncStore()

    async def respond(_request: httpx.Request) -> httpx.Response:
        async with CommittingSession(db_stack.sessions) as session:
            await crud.source.delete_source(session, uuid.UUID(source_id))
        return httpx.Response(
            200, json={"data": {"items": [{"row_id": "deleted"}]}}
        )

    async with httpx.AsyncClient(
        base_url="http://platform-test", transport=httpx.MockTransport(respond)
    ) as upstream:
        db_stack.app.state.container = replace(
            db_stack.app.state.container,
            platform=upstream,
            objectstore=cast(ObjectStore, store),
        )
        response = await db_stack.client.post(
            f"{API_PREFIX}/sources/{source_id}:sync"
        )
    assert response.status_code == 404
    assert not store.objects


@pytest.mark.parametrize("field", ["kind", "config_json", "base_id"])
async def test_changed_source_configuration_rejects_stale_snapshots(
    db_stack: DbStack, field: str
) -> None:
    _base_id, source_id = await _create(db_stack.client)
    made = await db_stack.client.post(BASES, json={"name": "另一个来源所属库"})
    other_base = uuid.UUID(made.json()["data"]["id"])
    values: dict[str, object] = {
        "kind": "upload",
        "config_json": {"path": "/new-platform-path"},
        "base_id": other_base,
    }
    store = _SyncStore()

    async def respond(_request: httpx.Request) -> httpx.Response:
        async with CommittingSession(db_stack.sessions) as session:
            await session.execute(
                update(crud.source.KnowledgeSource)
                .where(crud.source.KnowledgeSource.id == uuid.UUID(source_id))
                .values({field: values[field], "last_error": "新配置说明"})
            )
        return httpx.Response(
            200, json={"data": {"items": [{"row_id": "old-source"}]}}
        )

    async with httpx.AsyncClient(
        base_url="http://platform-test", transport=httpx.MockTransport(respond)
    ) as upstream:
        db_stack.app.state.container = replace(
            db_stack.app.state.container,
            platform=upstream,
            objectstore=cast(ObjectStore, store),
        )
        response = await db_stack.client.post(
            f"{API_PREFIX}/sources/{source_id}:sync"
        )
    assert response.status_code == 409
    assert not store.objects
    async with CommittingSession(db_stack.sessions) as session:
        source = await crud.source.get_source(session, uuid.UUID(source_id))
        assert source is not None
        assert getattr(source, field) == values[field]
        assert source.last_error == "新配置说明"
        assert source.last_synced_at is None
