"""真实查询取消后的事务恢复、关键词降级与 HTTP 错误契约。"""

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass

import pytest
from conftest import AppContext
from integration.collect_helpers import create_points, create_source, point_item
from pydantic import SecretStr
from sqlalchemy import event
from sqlalchemy.exc import DBAPIError
from sqlalchemy.exc import TimeoutError as DatabaseTimeoutError

from llmcore.endpoints import EmbeddingEndpoint
from platform_server.apps.collect.api import point_matches
from platform_server.apps.collect.services import point_search as search_module
from platform_server.apps.collect.services.point_embedding import (
    PointEmbeddingProfile,
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
    "timeout-space",
)


async def profile(_database: object, _cipher: object) -> PointEmbeddingProfile:
    return PROFILE


async def embedded(_profile: object, texts: list[str]) -> list[list[float]]:
    return [[1.0, 0.0] for _ in texts]


@dataclass
class QueryFailure:
    remaining: int = 1
    sqlstate: str = "57014"
    error: Exception | None = None


@pytest.fixture
async def canceled_search(
    app_context: AppContext, monkeypatch: pytest.MonkeyPatch
) -> AsyncIterator[QueryFailure]:
    """在真查询边界产生事务失败。Args: app_context, monkeypatch。"""
    failure = QueryFailure()
    connection = await app_context.session.connection()

    def cancel(*arguments: object) -> tuple[str, object]:
        statement, parameters = arguments[2:4]
        assert isinstance(statement, str)
        if "ranked AS (" in statement and failure.remaining:
            failure.remaining -= 1
            if failure.error is not None:
                raise failure.error
            return (
                "DO $$ BEGIN RAISE EXCEPTION 'controlled query failure' "
                "USING ERRCODE = '" + failure.sqlstate + "'; END $$",
                (),
            )
        return statement, parameters

    event.listen(
        connection.sync_connection, "before_cursor_execute", cancel, retval=True
    )
    monkeypatch.setattr(search_module, "load_profile", profile)
    monkeypatch.setattr(search_module, "embed_texts", embedded)
    monkeypatch.setattr(
        point_matches,
        "PointSearch",
        lambda _database, _cipher: PointSearch(app_context.sessions, None),
    )
    try:
        yield failure
    finally:
        event.remove(
            connection.sync_connection, "before_cursor_execute", cancel
        )


async def test_query_timeout_rolls_back_before_filtered_keyword_fallback(
    app_context: AppContext, canceled_search: QueryFailure
) -> None:
    source = await create_source(app_context.client)
    other = await create_source(app_context.client, code="other")
    for source_id in (source["id"], other["id"]):
        await create_points(app_context.client, source_id, point_item("K01"))
    response = await app_context.client.get(
        "/api/v1/platform/collect-point-matches",
        params={"q": "K01", "source_id": source["id"], "limit": 20},
    )
    assert response.status_code == 200
    result = response.json()["data"]
    assert result["mode"] == "keyword"
    assert "超时" in result["note"]
    assert result["pending_count"] == 1
    assert [item["source_id"] for item in result["items"]] == [source["id"]]
    assert result["items"][0]["is_exact"] is True
    assert canceled_search.remaining == 0


async def test_keyword_timeout_returns_explicit_unavailable_response(
    app_context: AppContext, canceled_search: QueryFailure
) -> None:
    canceled_search.remaining = 2
    response = await app_context.client.get(
        "/api/v1/platform/collect-point-matches", params={"q": "K11"}
    )
    assert response.status_code == 503
    assert response.json()["code"] == 51104
    assert "超时" in response.json()["message"]
    assert response.json()["data"] is None
    assert response.json()["trace_id"]


async def test_unrelated_database_errors_are_not_disguised_as_keyword_results(
    app_context: AppContext, canceled_search: QueryFailure
) -> None:
    canceled_search.sqlstate = "22000"
    with pytest.raises(DBAPIError, match="controlled query failure"):
        await PointSearch(app_context.sessions, None).search("K01", None, 20)


async def test_timeout_fallback_does_not_invent_pending_points(
    app_context: AppContext, canceled_search: QueryFailure
) -> None:
    result = await PointSearch(app_context.sessions, None).search(
        "K01", uuid.UUID(int=1), 20
    )
    assert result.items == []
    assert result.pending_count == 0
    assert result.mode == "keyword"
    assert canceled_search.remaining == 0


@pytest.mark.parametrize("error_type", [TimeoutError, DatabaseTimeoutError])
async def test_driver_timeouts_also_degrade_to_keyword_search(
    app_context: AppContext,
    canceled_search: QueryFailure,
    error_type: type[Exception],
) -> None:
    canceled_search.error = error_type("controlled driver timeout")
    result = await PointSearch(app_context.sessions, None).search(
        "K01", None, 20
    )
    assert result.mode == "keyword"
    assert result.note is not None
    assert "超时" in result.note


async def test_keyword_only_timeout_is_not_repeated(
    app_context: AppContext,
    canceled_search: QueryFailure,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def missing_profile(_database: object, _cipher: object) -> None:
        return None

    monkeypatch.setattr(search_module, "load_profile", missing_profile)
    canceled_search.remaining = 2
    response = await app_context.client.get(
        "/api/v1/platform/collect-point-matches", params={"q": "K01"}
    )
    assert response.status_code == 503
    assert response.json()["code"] == 51104
    assert canceled_search.remaining == 1
