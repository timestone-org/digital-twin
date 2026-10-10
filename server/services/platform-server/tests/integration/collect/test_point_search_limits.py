"""真实 PostgreSQL 守点位候选扩容、精确优先与数据源隔离。"""

import uuid

import pytest
from conftest import AppContext
from integration.collect_helpers import create_points, create_source, point_item
from pydantic import SecretStr

from llmcore.endpoints import EmbeddingEndpoint
from platform_server.apps.collect.api import point_matches
from platform_server.apps.collect.crud import point_semantic
from platform_server.apps.collect.services import point_search as search_module
from platform_server.apps.collect.services.point_embedding import (
    PointEmbeddingProfile,
)
from platform_server.apps.collect.services.point_search import PointSearch

pytestmark = pytest.mark.requires_postgres
MATCHES = "/api/v1/platform/collect-point-matches"
PROFILE = PointEmbeddingProfile(
    EmbeddingEndpoint(
        base_url="https://embedding.test/v1",
        api_key=SecretStr("test"),
        model="test",
        timeout_s=1,
        dimensions=2,
    ),
    "point-search-limits",
)


@pytest.fixture(autouse=True)
def same_connection_search(
    app_context: AppContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    """让搜索短事务复用用例保存点。Args: app_context, monkeypatch。"""

    def build_search(_database: object, _cipher: object) -> PointSearch:
        return PointSearch(app_context.sessions, None)

    monkeypatch.setattr(point_matches, "PointSearch", build_search)


async def seed_points(context: AppContext) -> str:
    """创建超出单路候选预算的点位。Args: context。"""
    source = await create_source(context.client)
    await create_points(
        context.client,
        source["id"],
        point_item("temperature"),
        *(point_item(f"temperature-{index:03d}") for index in range(105)),
    )
    return source["id"]


async def profile(_database: object, _cipher: object) -> PointEmbeddingProfile:
    """读取固定测试嵌入档。Args: _database, _cipher。"""
    return PROFILE


async def embedded(_profile: object, texts: list[str]) -> list[list[float]]:
    """返回固定向量且不发外部请求。Args: _profile, texts。"""
    return [[1.0, 0.0] for _ in texts]


async def index_points(context: AppContext) -> None:
    """分批写入有效向量。Args: context。"""
    while items := await point_semantic.pending(
        context.session, PROFILE.signature
    ):
        await point_semantic.save_many(
            context.session,
            items,
            PROFILE.signature,
            [[1.0, 0.0] for _ in items],
        )


@pytest.mark.parametrize("limit", [1, 20, 60, 100])
async def test_search_accepts_bounded_candidate_counts(
    app_context: AppContext, limit: int
) -> None:
    source = await seed_points(app_context)
    response = await app_context.client.get(
        MATCHES,
        params={"q": "temperature", "source_id": source, "limit": limit},
    )
    assert response.status_code == 200
    result = response.json()["data"]
    assert len(result["items"]) == limit
    assert result["items"][0]["code"] == "temperature"
    assert result["items"][0]["is_exact"] is True


async def test_search_keeps_default_candidate_count(
    app_context: AppContext,
) -> None:
    source = await seed_points(app_context)
    response = await app_context.client.get(
        MATCHES, params={"q": "temperature", "source_id": source}
    )
    assert response.status_code == 200
    assert len(response.json()["data"]["items"]) == 6


async def test_keyword_lane_returns_one_hundred_distinct_filtered_candidates(
    app_context: AppContext,
) -> None:
    source = await seed_points(app_context)
    other = await create_source(app_context.client, code="other-source")
    await create_points(
        app_context.client, other["id"], point_item("temperature")
    )
    found, pending = await point_semantic.search(
        app_context.session,
        {
            "source_id": uuid.UUID(source),
            "query": "temperature",
            "signature": "",
            "probe": None,
            "limit": 100,
        },
    )
    assert len(found) == 100
    assert len({one["node_key"] for one in found}) == 100
    assert {one["source_id"] for one in found} == {uuid.UUID(source)}
    assert found[0]["code"] == "temperature"
    assert found[0]["is_exact"] is True
    assert pending == 106


async def test_semantic_lane_returns_one_hundred_filtered_candidates(
    app_context: AppContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = await seed_points(app_context)
    other = await create_source(app_context.client, code="other-source")
    await create_points(
        app_context.client, other["id"], point_item("unrelated")
    )
    await index_points(app_context)
    monkeypatch.setattr(search_module, "load_profile", profile)
    monkeypatch.setattr(search_module, "embed_texts", embedded)
    response = await app_context.client.get(
        MATCHES,
        params={"q": "设备热不热", "source_id": source, "limit": 100},
    )
    assert response.status_code == 200
    result = response.json()["data"]
    assert len(result["items"]) == 100
    assert len({one["node_key"] for one in result["items"]}) == 100
    assert {one["source_id"] for one in result["items"]} == {source}
    assert result["mode"] == "hybrid"
    assert result["pending_count"] == 0
    assert result["note"] is None
