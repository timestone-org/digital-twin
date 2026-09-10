"""真 PostgreSQL 上验证点位语义召回、更新作废、删除和并发回执。"""

import uuid

import pytest
from conftest import AppContext, SignHeaders
from integration.collect_helpers import (
    POINTS,
    SOURCES,
    create_points,
    create_source,
    point_item,
)
from sqlalchemy import text

from platform_server.apps.collect.crud import point_semantic
from platform_server.apps.collect.services.point_search import PointSearch

pytestmark = pytest.mark.requires_postgres


async def seeded(
    context: AppContext,
) -> tuple[str, list[point_semantic.PendingPoint]]:
    source = await create_source(context.client)
    await create_points(
        context.client,
        source["id"],
        point_item("temp", name="出风口温度", description="一号机送风测温"),
        point_item("pressure", name="压力", unit="Pa"),
    )
    return source["id"], await point_semantic.pending(
        context.session, "model-a"
    )


def query(source: str, text_value: str = "送风热不热") -> dict[str, object]:
    return {
        "source_id": uuid.UUID(source),
        "query": text_value,
        "signature": "model-a",
        "probe": [1.0, 0.0],
        "limit": 6,
    }


async def test_semantics_find_a_point_without_a_shared_keyword(
    app_context: AppContext,
) -> None:
    source, items = await seeded(app_context)
    for item in items:
        vector = [1.0, 0.0] if "temp" in item.content else [0.0, 1.0]
        await point_semantic.save(app_context.session, item, "model-a", vector)
    found, pending = await point_semantic.search(
        app_context.session, query(source)
    )
    assert [one["code"] for one in found] == ["temp"]
    assert pending == 0


async def test_exact_code_precedes_a_semantically_closer_candidate(
    app_context: AppContext,
) -> None:
    source, items = await seeded(app_context)
    for item in items:
        await point_semantic.save(
            app_context.session, item, "model-a", [1.0, 0.0]
        )
    found, _ = await point_semantic.search(
        app_context.session, query(source, "pressure")
    )
    assert found[0]["code"] == "pressure"
    assert found[0]["is_exact"] is True


async def test_edit_invalidates_old_embedding_and_late_result(
    app_context: AppContext,
) -> None:
    source, items = await seeded(app_context)
    item = next(one for one in items if "temp" in one.content)
    await point_semantic.save(app_context.session, item, "model-a", [1.0, 0.0])
    response = await app_context.client.patch(
        f"{POINTS}/{item.point_id}", json={"description": "改为冷凝器进口测温"}
    )
    assert response.status_code == 200
    await point_semantic.save(app_context.session, item, "model-a", [1.0, 0.0])
    found, pending = await point_semantic.search(
        app_context.session, query(source)
    )
    assert found == []
    assert pending == 2


async def test_source_edit_also_invalidates_its_point_vectors(
    app_context: AppContext,
) -> None:
    source, items = await seeded(app_context)
    for item in items:
        await point_semantic.save(
            app_context.session, item, "model-a", [1.0, 0.0]
        )
    response = await app_context.client.patch(
        f"{SOURCES}/{source}", json={"name": "二号机"}
    )
    assert response.status_code == 200
    found, pending = await point_semantic.search(
        app_context.session, query(source)
    )
    assert found == []
    assert pending == 2


async def test_deletion_removes_vectors_and_late_writes_cannot_resurrect(
    app_context: AppContext,
) -> None:
    source, items = await seeded(app_context)
    item = items[0]
    await point_semantic.save(app_context.session, item, "model-a", [1.0, 0.0])
    response = await app_context.client.delete(f"{POINTS}/{item.point_id}")
    assert response.status_code == 204
    await point_semantic.save(app_context.session, item, "model-a", [1.0, 0.0])
    found, _ = await point_semantic.search(app_context.session, query(source))
    assert found == []
    assert (
        await app_context.session.scalar(
            text("SELECT count(*) FROM platform.collect_point_embeddings")
        )
        == 0
    )


async def test_model_spaces_are_never_mixed_and_failure_cannot_replace_success(
    app_context: AppContext,
) -> None:
    source, items = await seeded(app_context)
    for item in items:
        await point_semantic.save(
            app_context.session, item, "model-b", [0.0, 1.0, 0.0]
        )
    found, pending = await point_semantic.search(
        app_context.session, query(source)
    )
    assert found == []
    assert pending == 2
    item = next(one for one in items if "temp" in one.content)
    await point_semantic.save(app_context.session, item, "model-a", [1.0, 0.0])
    await point_semantic.save(app_context.session, item, "model-a", None)
    found, _ = await point_semantic.search(app_context.session, query(source))
    assert [one["code"] for one in found] == ["temp"]


async def test_missing_model_explicitly_returns_keyword_mode(
    app_context: AppContext,
) -> None:
    source, _ = await seeded(app_context)
    result = await PointSearch(app_context.sessions, None).search(
        "送风", uuid.UUID(source), 6
    )
    assert result.mode == "keyword"
    assert result.note is not None
    assert "未分配" in result.note
    assert result.pending_count == 2
    assert [one.code for one in result.items] == ["temp"]


async def test_description_roundtrips_and_explicit_null_clears(
    app_context: AppContext,
) -> None:
    source, items = await seeded(app_context)
    response = await app_context.client.get(
        POINTS, params={"source_id": source}
    )
    assert response.status_code == 200
    rows = response.json()["data"]["items"]
    assert (
        next(one for one in rows if one["code"] == "temp")["description"]
        == "一号机送风测温"
    )
    item = next(one for one in items if "temp" in one.content)
    response = await app_context.client.patch(
        f"{POINTS}/{item.point_id}", json={"description": None}
    )
    assert response.status_code == 200
    assert response.json()["data"]["point"]["description"] is None


@pytest.mark.parametrize(
    "parameters",
    [
        {"q": ""},
        {"q": " "},
        {"q": "x" * 301},
        {"q": "温度", "limit": 13},
        {"q": "温度", "source_id": "../x"},
    ],
)
async def test_search_rejects_unbounded_or_invalid_input(
    app_context: AppContext, parameters: dict[str, str | int]
) -> None:
    response = await app_context.client.get(
        "/api/v1/platform/collect-point-matches", params=parameters
    )
    assert response.status_code == 400


async def test_knowledge_permission_does_not_grant_access_to_point_search(
    app_context: AppContext, sign: SignHeaders
) -> None:
    response = await app_context.client.get(
        "/api/v1/platform/collect-point-matches",
        params={"q": "温度"},
        headers=sign(codes=["knowledge:use"]),
    )
    assert response.status_code == 403


async def test_read_only_collect_permission_can_use_search(
    app_context: AppContext, sign: SignHeaders
) -> None:
    response = await app_context.client.get(
        "/api/v1/platform/collect-point-matches",
        params={"q": "不存在的点位"},
        headers=sign(codes=["collect:view"]),
    )
    assert response.status_code == 200
    assert response.json()["data"]["items"] == []
    assert response.json()["data"]["mode"] == "keyword"
