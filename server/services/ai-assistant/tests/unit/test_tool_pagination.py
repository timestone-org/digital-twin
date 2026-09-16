"""工具列表必须有界且能继续读取后续记录。"""

import httpx
import pytest

from ai_assistant.apps.chat.services.tools.providers.knowledge import (
    KnowledgeTools,
)
from ai_assistant.apps.chat.services.tools.providers.server import ServerTools
from ai_assistant.upstream import KnowledgeClient, PlatformClient


@pytest.mark.parametrize(
    ("name", "path", "key"),
    [
        ("dashboards.list", "dashboards", "dashboards"),
        ("datasets.list_tables", "dataset-tables", "tables"),
        ("points.list_sources", "collect-sources", "sources"),
    ],
)
async def test_listing_follows_next_page(
    name: str, path: str, key: str
) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.url.path.endswith(path)
        page = int(request.url.params.get("page", "1"))
        size = int(request.url.params["size"])
        rows = [{"id": str(index)} for index in range(25)]
        return httpx.Response(
            200,
            json={
                "data": {
                    "items": rows[(page - 1) * size : page * size],
                    "total": 25,
                }
            },
        )

    client = PlatformClient(base_url="http://platform.test", timeout_s=5)
    client.use_transport(httpx.MockTransport(handler))
    tools = ServerTools(platform=client)
    try:
        first = await tools.run(name, {"limit": 20})
        assert len(first[key]) == 20
        assert first["has_more"] is True
        second = await tools.run(
            name, {"limit": 20, "page": first["next_page"]}
        )
        assert [row["id"] for row in second[key]] == [
            str(i) for i in range(20, 25)
        ]
        assert second["has_more"] is False
        assert second["next_page"] is None
        assert len(requests) == 2
    finally:
        await client.close()


@pytest.mark.parametrize(
    "arguments",
    [
        {"page": 0},
        {"page": -1},
        {"page": True},
        {"page": "2"},
        {"limit": 0},
        {"limit": 21},
        {"limit": True},
        {"limit": 1.5},
    ],
)
async def test_invalid_window_is_rejected(arguments: dict[str, object]) -> None:
    with pytest.raises(ValueError, match=r"page|limit"):
        await ServerTools().run("dashboards.list", arguments)


async def test_assets_use_offset_and_lookahead_without_losing_records() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["q"] == "泵"
        assert request.url.params["kind"] == "model"
        offset = int(request.url.params["offset"])
        limit = int(request.url.params["limit"])
        assert limit == 3
        rows = [{"id": str(index)} for index in range(5)]
        return httpx.Response(200, json={"data": rows[offset : offset + limit]})

    client = PlatformClient(base_url="http://platform.test", timeout_s=5)
    client.use_transport(httpx.MockTransport(handler))
    tools = ServerTools(platform=client)
    arguments: dict[str, object] = {
        "limit": 2,
        "keyword": "泵",
        "kind": "model",
    }
    seen: list[str] = []
    try:
        for page in (1, 2, 3):
            result = await tools.run(
                "assets.search", {**arguments, "page": page}
            )
            seen.extend(row["id"] for row in result["assets"])
        assert seen == ["0", "1", "2", "3", "4"]
        assert result["next_page"] is None
    finally:
        await client.close()


async def test_columns_filter_before_paging() -> None:
    client = PlatformClient(base_url="http://platform.test", timeout_s=5)
    client.use_transport(
        httpx.MockTransport(
            lambda _: httpx.Response(
                200,
                json={
                    "data": [
                        {"key": "T1", "name": "温度"},
                        {"key": "F", "name": "流量"},
                        {"key": "T2", "name": "温度"},
                    ],
                },
            )
        )
    )
    try:
        result = await ServerTools(platform=client).run(
            "datasets.read_columns",
            {
                "table_id": "t1",
                "keyword": "温度",
                "limit": 1,
                "page": 2,
            },
        )
        assert result["columns"][0]["key"] == "T2"
        assert result["total"] == 2
        assert result["next_page"] is None
    finally:
        await client.close()


async def test_knowledge_bases_follow_upstream_page_and_identity() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["X-Auth-Sig"] == "test-signature"
        assert request.url.params["page"] == "2"
        assert request.url.params["size"] == "20"
        return httpx.Response(
            200,
            json={
                "data": {
                    "items": [{"id": "last", "name": "末页知识库"}],
                    "total": 21,
                }
            },
        )

    client = KnowledgeClient(base_url="http://knowledge.test", timeout_s=5)
    client.use_transport(httpx.MockTransport(handler))
    try:
        result = await KnowledgeTools(
            client=client, headers={"X-Auth-Sig": "test-signature"}
        ).run(
            "knowledge.list_bases",
            {"page": 2},
        )
        assert result["bases"][0]["id"] == "last"
        assert result["total"] == 21
        assert result["next_page"] is None
    finally:
        await client.close()
