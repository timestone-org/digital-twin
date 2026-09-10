"""索引 worker 的真实事务、失败冷却与短事务搜索。"""

import uuid

import pytest
from conftest import AppContext
from integration.collect_helpers import create_points, create_source, point_item
from pydantic import SecretStr

from llmcore.endpoints import EmbeddingEndpoint
from platform_server.apps.collect.crud import point_semantic
from platform_server.apps.collect.services import (
    point_index_worker as worker_module,
)
from platform_server.apps.collect.services import point_search as search_module
from platform_server.apps.collect.services.point_embedding import (
    PointEmbeddingProfile,
)
from platform_server.apps.collect.services.point_index_worker import (
    PointIndexWorker,
)
from platform_server.apps.collect.services.point_search import PointSearch

pytestmark = pytest.mark.requires_postgres
PROFILE = PointEmbeddingProfile(
    EmbeddingEndpoint(
        base_url="https://embedding.test/v1",
        api_key=SecretStr("test"),
        model="test",
        timeout_s=1,
        dimensions=2,
    ),
    "space-a",
)


async def profile(_database: object, _cipher: object) -> PointEmbeddingProfile:
    return PROFILE


async def embedded(_profile: object, texts: list[str]) -> list[list[float]]:
    return [[1.0, 0.0] for _ in texts]


async def failed(_profile: object, _texts: list[str]) -> list[list[float]]:
    raise RuntimeError("fake embedding unavailable")


async def test_worker_builds_index_and_search_reads_it(
    app_context: AppContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = await create_source(app_context.client)
    await create_points(
        app_context.client, source["id"], point_item(description="送风测温")
    )
    monkeypatch.setattr(worker_module, "load_profile", profile)
    monkeypatch.setattr(worker_module, "embed_texts", embedded)
    worker = PointIndexWorker(app_context.sessions, None)
    assert await worker.run_once() == 1
    assert await worker.run_once() == 0
    monkeypatch.setattr(search_module, "load_profile", profile)
    monkeypatch.setattr(search_module, "embed_texts", embedded)
    result = await PointSearch(app_context.sessions, None).search(
        "热不热", uuid.UUID(source["id"]), 6
    )
    assert result.mode == "hybrid"
    assert result.pending_count == 0
    assert len(result.items) == 1
    assert result.note is None


async def test_embedding_failure_is_cooled_down_and_search_declares_degradation(
    app_context: AppContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = await create_source(app_context.client)
    await create_points(app_context.client, source["id"])
    monkeypatch.setattr(worker_module, "load_profile", profile)
    monkeypatch.setattr(worker_module, "embed_texts", failed)
    worker = PointIndexWorker(app_context.sessions, None)
    with pytest.raises(RuntimeError, match="unavailable"):
        await worker.run_once()
    assert (
        await point_semantic.pending(app_context.session, PROFILE.signature)
        == []
    )
    monkeypatch.setattr(search_module, "load_profile", profile)
    monkeypatch.setattr(search_module, "embed_texts", failed)
    result = await PointSearch(app_context.sessions, None).search(
        "出口", uuid.UUID(source["id"]), 6
    )
    assert result.mode == "keyword"
    assert result.note is not None
    assert "暂不可用" in result.note
    assert len(result.items) == 1


async def test_unindexed_points_are_reported_even_when_semantic_query_succeeds(
    app_context: AppContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = await create_source(app_context.client)
    await create_points(app_context.client, source["id"])
    monkeypatch.setattr(search_module, "load_profile", profile)
    monkeypatch.setattr(search_module, "embed_texts", embedded)
    result = await PointSearch(app_context.sessions, None).search(
        "出口", uuid.UUID(source["id"]), 6
    )
    assert result.mode == "hybrid"
    assert result.pending_count == 1
    assert result.note is not None
    assert "等待语义索引" in result.note


async def test_missing_profile_does_not_block_worker(
    app_context: AppContext,
) -> None:
    assert await PointIndexWorker(app_context.sessions, None).run_once() == 0
