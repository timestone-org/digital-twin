"""已授权同步的原件快照通过真实数据库摄取，不再次读取平台。"""

import uuid
from collections.abc import AsyncIterator, Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, replace

import httpx
import pytest
from integration.conftest import DbStack
from integration.test_ingest_pipeline import _Embedder
from integration.test_platform_source_identity import (
    _platform,
    _source_id,
    _SyncStore,
)
from sqlalchemy import select

from knowledge_server.apps.knowledge.models import (
    KnowledgeDocument,
    KnowledgeSource,
)
from knowledge_server.apps.knowledge.services.indexing import build_indexes
from knowledge_server.apps.knowledge.services.ingest_pipeline import (
    IngestDeps,
    IngestFailed,
    Sessions,
    ingest,
)
from knowledge_server.apps.knowledge.services.sources import (
    SourceDeps,
    SourceUnavailable,
    build_sources,
)
from knowledge_server.settings import Settings
from lib.objectstore import ObjectNotFound, ObjectStat, ObjectStoreUnavailable

pytestmark = pytest.mark.requires_postgres


class _SnapshotStore(_SyncStore):
    """记录真实边界调用，原件与对象存在性由外部存储替身提供。"""

    def __init__(self) -> None:
        super().__init__()
        self.read_keys: list[str] = []
        self.is_unavailable = False

    async def stat(self, key: str) -> ObjectStat | None:
        if self.is_unavailable:
            raise ObjectStoreUnavailable("测试存储暂时不可用")
        if key not in self.objects:
            return None
        return ObjectStat(key, len(self.objects[key]), "text/markdown", "test")

    async def get_bytes(self, key: str) -> bytes:
        self.read_keys.append(key)
        if key not in self.objects:
            raise ObjectNotFound("测试原件不存在")
        return self.objects[key]


@dataclass(frozen=True)
class _Snapshot:
    stack: DbStack
    document_id: uuid.UUID
    object_key: str
    store: _SnapshotStore
    platform: httpx.AsyncClient
    requests: list[str]


@pytest.fixture
def pool() -> Iterator[ThreadPoolExecutor]:
    """测试本地解析；生产管线使用独立进程池。"""
    with ThreadPoolExecutor(max_workers=1) as made:
        yield made


async def _registered(stack: DbStack) -> tuple[uuid.UUID, str]:
    source_id = await _source_id(stack.client)
    response = await stack.client.post(
        f"/api/v1/knowledge/sources/{source_id}:sync"
    )
    assert response.status_code == 200
    assert response.json()["data"]["registered"] == 1
    async with stack.sessions() as session:
        document = await session.scalar(
            select(KnowledgeDocument).where(
                KnowledgeDocument.source_id == uuid.UUID(source_id)
            )
        )
        assert document is not None
        return document.id, document.object_key


@pytest.fixture
async def snapshot(
    db_stack: DbStack,
    settings: Settings,
    sign: Callable[..., dict[str, str]],
) -> AsyncIterator[_Snapshot]:
    store = _SnapshotStore()
    requests: list[str] = []

    async def recorded(request: httpx.Request) -> None:
        requests.append(request.url.path)

    db_stack.client.headers.update(
        sign(
            codes=(
                "knowledge:use",
                "knowledge:write",
                "knowledge:manage",
                "dataset:view",
            )
        )
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=_platform(settings)),
        base_url="http://platform-test",
        event_hooks={"request": [recorded]},
    ) as platform:
        db_stack.app.state.container = replace(
            db_stack.app.state.container, platform=platform, objectstore=store
        )
        document_id, key = await _registered(db_stack)
        yield _Snapshot(db_stack, document_id, key, store, platform, requests)


def _deps(
    snapshot: _Snapshot, dimensions: int, pool: ThreadPoolExecutor
) -> IngestDeps:
    return IngestDeps(
        sources=build_sources(
            SourceDeps(store=snapshot.store, platform=snapshot.platform)
        ),
        embedder=_Embedder(dimensions),
        indexes=build_indexes(dimensions),
        pool=pool,
        store=snapshot.store,
        parse_timeout_s=30.0,
    )


async def test_platform_snapshot_reaches_ready_without_platform_fetch(
    snapshot: _Snapshot,
    db_sessions: Sessions,
    db_dimensions: int,
    pool: ThreadPoolExecutor,
) -> None:
    made = await ingest(
        db_sessions, _deps(snapshot, db_dimensions, pool), snapshot.document_id
    )
    assert made == "ready"
    assert snapshot.requests == ["/api/v1/platform/dataset-tables"]
    assert snapshot.store.read_keys == [snapshot.object_key]
    response = await snapshot.stack.client.get(
        f"/api/v1/knowledge/documents/{snapshot.document_id}"
    )
    assert response.status_code == 200
    assert response.json()["data"]["status"] == "ready"
    assert response.json()["data"]["chunk_count"] == 1


async def test_platform_snapshot_requires_a_persisted_object_key(
    snapshot: _Snapshot,
    db_sessions: Sessions,
    db_dimensions: int,
    pool: ThreadPoolExecutor,
) -> None:
    async with db_sessions() as session:
        document = await session.get(KnowledgeDocument, snapshot.document_id)
        assert document is not None
        document.object_key = ""
    with pytest.raises(IngestFailed, match="快照未登记"):
        await ingest(
            db_sessions,
            _deps(snapshot, db_dimensions, pool),
            snapshot.document_id,
        )
    assert snapshot.store.read_keys == []
    assert len(snapshot.requests) == 1


async def test_snapshot_uses_document_key_instead_of_external_ref_or_config(
    snapshot: _Snapshot,
    db_sessions: Sessions,
    db_dimensions: int,
    pool: ThreadPoolExecutor,
) -> None:
    async with db_sessions() as session:
        document = await session.get(KnowledgeDocument, snapshot.document_id)
        assert document is not None
        source = await session.get(KnowledgeSource, document.source_id)
        assert source is not None
        document.external_ref = "untrusted.md"
        source.config_json = {"path": "/other", "object_key": "untrusted.md"}
    assert (
        await ingest(
            db_sessions,
            _deps(snapshot, db_dimensions, pool),
            snapshot.document_id,
        )
        == "ready"
    )
    assert snapshot.store.read_keys == [snapshot.object_key]
    assert len(snapshot.requests) == 1


async def test_missing_snapshot_object_fails_without_refetching_platform(
    snapshot: _Snapshot,
    db_sessions: Sessions,
    db_dimensions: int,
    pool: ThreadPoolExecutor,
) -> None:
    snapshot.store.objects.clear()
    with pytest.raises(IngestFailed, match="不在对象存储里"):
        await ingest(
            db_sessions,
            _deps(snapshot, db_dimensions, pool),
            snapshot.document_id,
        )
    assert snapshot.store.read_keys == [snapshot.object_key]
    assert len(snapshot.requests) == 1


async def test_unknown_snapshot_reader_fails_without_empty_fallback(
    snapshot: _Snapshot,
    db_sessions: Sessions,
    db_dimensions: int,
    pool: ThreadPoolExecutor,
) -> None:
    deps = replace(_deps(snapshot, db_dimensions, pool), sources=())
    with pytest.raises(IngestFailed, match="没有叫 upload 的来源"):
        await ingest(db_sessions, deps, snapshot.document_id)
    assert snapshot.store.read_keys == []
    assert len(snapshot.requests) == 1


async def test_transient_store_error_stays_distinct_from_missing_original(
    snapshot: _Snapshot,
    db_sessions: Sessions,
    db_dimensions: int,
    pool: ThreadPoolExecutor,
) -> None:
    snapshot.store.is_unavailable = True
    with pytest.raises(SourceUnavailable, match="对象存储暂时不可用"):
        await ingest(
            db_sessions,
            _deps(snapshot, db_dimensions, pool),
            snapshot.document_id,
        )
    assert snapshot.store.read_keys == []
    assert len(snapshot.requests) == 1


async def test_upload_still_reads_original_external_ref(
    snapshot: _Snapshot,
    db_sessions: Sessions,
    db_dimensions: int,
    pool: ThreadPoolExecutor,
) -> None:
    snapshot.store.objects["legacy.md"] = snapshot.store.objects[
        snapshot.object_key
    ]
    async with db_sessions() as session:
        document = await session.get(KnowledgeDocument, snapshot.document_id)
        assert document is not None
        source = await session.get(KnowledgeSource, document.source_id)
        assert source is not None
        source.kind = "upload"
        document.external_ref = "legacy.md"
        document.object_key = "other.md"
    assert (
        await ingest(
            db_sessions,
            _deps(snapshot, db_dimensions, pool),
            snapshot.document_id,
        )
        == "ready"
    )
    assert snapshot.store.read_keys == ["legacy.md"]
    assert len(snapshot.requests) == 1


async def test_empty_platform_snapshot_is_not_a_ready_document(
    snapshot: _Snapshot,
    db_sessions: Sessions,
    db_dimensions: int,
    pool: ThreadPoolExecutor,
) -> None:
    snapshot.store.objects[snapshot.object_key] = b""
    with pytest.raises(IngestFailed, match="原件快照为空"):
        await ingest(
            db_sessions,
            _deps(snapshot, db_dimensions, pool),
            snapshot.document_id,
        )
    response = await snapshot.stack.client.get(
        f"/api/v1/knowledge/documents/{snapshot.document_id}"
    )
    assert response.json()["data"]["status"] != "ready"
    assert len(snapshot.requests) == 1
