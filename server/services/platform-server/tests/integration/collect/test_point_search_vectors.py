"""原生向量计算的扩展定位、维数隔离与万级目录查询预算。"""

import uuid

import pytest
from conftest import AppContext
from integration.collect_helpers import create_points, create_source, point_item
from sqlalchemy import text

from platform_server.apps.collect.crud import point_semantic

pytestmark = pytest.mark.requires_postgres


@pytest.fixture
async def vector_source(app_context: AppContext) -> uuid.UUID:
    """在独立 schema 安装测试扩展。Args: app_context。"""
    await app_context.session.execute(text('CREATE SCHEMA "point vector test"'))
    await app_context.session.execute(
        text('CREATE EXTENSION IF NOT EXISTS vector SCHEMA "point vector test"')
    )
    source = await create_source(app_context.client)
    return uuid.UUID(source["id"])


async def test_large_indexed_catalog_fits_the_hot_query_budget(
    app_context: AppContext, vector_source: uuid.UUID
) -> None:
    await app_context.session.execute(
        text("""
INSERT INTO platform.collect_points
 (id, source_id, code, name, address, data_type, sampling_interval_ms,
  deadband, archive_enabled, archive_max_interval_ms)
SELECT md5('point-search-' || item)::uuid, :source,
 CASE WHEN item = 1 THEN 'K01' ELSE 'K01-' || item END,
 '温度', 'ns=2;s=' || item, 'float', 1000, 0, false, 60000
FROM generate_series(1, 30000) item
"""),
        {"source": vector_source},
    )
    await app_context.session.execute(
        text(point_semantic._CATALOG + """
INSERT INTO platform.collect_point_embeddings
 (point_id, content_hash, model_signature, embedding)
SELECT id, content_hash, 'capacity', CAST(:vector AS double precision[])
FROM catalog WHERE source_id = :source
"""),
        {"source": vector_source, "vector": [1.0] + [0.0] * 1023},
    )
    await app_context.session.execute(
        text("SET LOCAL statement_timeout = '2s'")
    )
    found, pending = await point_semantic.search(
        app_context.session,
        {
            "query": "K01",
            "source_id": vector_source,
            "limit": 20,
            "signature": "capacity",
            "probe": [1.0] + [0.0] * 1023,
        },
    )
    assert len(found) == 20
    assert found[0]["code"] == "K01"
    assert found[0]["is_exact"] is True
    assert pending == 0


async def test_native_search_excludes_wrong_dimensions_and_stale_models(
    app_context: AppContext, vector_source: uuid.UUID
) -> None:
    await create_points(
        app_context.client,
        str(vector_source),
        point_item("correct"),
        point_item("wrong-size"),
        point_item("old-model"),
    )
    items = await point_semantic.pending(app_context.session, "current")
    for item in items:
        if "wrong-size" in item.content:
            signature, vector = "current", [1.0, 0.0, 0.0]
        elif "old-model" in item.content:
            signature, vector = "old", [1.0, 0.0]
        else:
            signature, vector = "current", [1.0, 0.0]
        await point_semantic.save(app_context.session, item, signature, vector)
    found, pending = await point_semantic.search(
        app_context.session,
        {
            "query": "设备热不热",
            "source_id": vector_source,
            "limit": 20,
            "signature": "current",
            "probe": [1.0, 0.0],
        },
    )
    assert [item["code"] for item in found] == ["correct"]
    assert pending == 1


async def test_extension_search_path_stays_inside_the_search_transaction(
    app_context: AppContext, vector_source: uuid.UUID
) -> None:
    before = await app_context.session.scalar(text("SHOW search_path"))
    async with app_context.sessions.session() as session:
        await point_semantic.search(
            session,
            {
                "query": "K11",
                "source_id": vector_source,
                "limit": 20,
                "signature": "current",
                "probe": [1.0, 0.0],
            },
        )
    after = await app_context.session.scalar(text("SHOW search_path"))
    assert after == before
