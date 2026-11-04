"""内置模板目录的只读权限、完整分页和后端检索。"""

import httpx
import pytest
from conftest import SignHeaders

from integration.modeling_helpers import data_of

URL = "/api/v1/platform/modeling-builtin-templates"
pytestmark = pytest.mark.requires_postgres


async def test_builtin_catalog_pages_preserve_the_complete_original_order(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(URL, params={"size": 200})
    assert response.status_code == 200, response.text
    complete = data_of(response)
    assert complete["total"] == len(complete["items"])
    assert complete["total"] > 10
    keys = [item["key"] for item in complete["items"]]
    assert keys[:5] == [
        "regression_model",
        "classification_model",
        "clustering_analysis",
        "anomaly_model",
        "regression",
    ]
    assert keys[-1] == "blank"
    assert len(keys) == len(set(keys))
    paged: list[str] = []
    for page in range(1, (complete["total"] + 2) // 3 + 1):
        payload = data_of(
            await app_client.get(URL, params={"page": page, "size": 3})
        )
        assert payload["total"] == complete["total"]
        paged.extend(item["key"] for item in payload["items"])
    assert paged == keys
    empty = data_of(await app_client.get(URL, params={"page": 999, "size": 3}))
    assert empty["items"] == []
    assert empty["total"] == complete["total"]
    assert all(
        set(item) == {"key", "label", "hint", "category"}
        for item in complete["items"]
    )


@pytest.mark.parametrize(
    "category", ["prediction", "detection", "analysis", "rule"]
)
async def test_builtin_catalog_filters_category_before_paging(
    app_client: httpx.AsyncClient, category: str
) -> None:
    payload = data_of(
        await app_client.get(URL, params={"category": category, "size": 200})
    )
    assert payload["items"]
    assert all(item["category"] == category for item in payload["items"])
    assert "blank" not in {item["key"] for item in payload["items"]}
    first = data_of(
        await app_client.get(URL, params={"category": category, "size": 1})
    )
    assert first["total"] == payload["total"]
    assert first["items"] == payload["items"][:1]


async def test_builtin_catalog_search_is_trimmed_case_insensitive_and_literal(
    app_client: httpx.AsyncClient,
) -> None:
    result = data_of(
        await app_client.get(URL, params={"q": " cOp ", "category": "rule"})
    )
    assert result["total"] == 1
    assert "COP" in result["items"][0]["hint"]
    for keyword in ("%", "_", "\\"):
        payload = data_of(
            await app_client.get(URL, params={"q": keyword, "size": 200})
        )
        assert all(
            keyword in f"{item['label']} {item['hint']}"
            for item in payload["items"]
        )
    blank = data_of(await app_client.get(URL, params={"q": "   "}))
    unfiltered = data_of(await app_client.get(URL))
    assert blank == unfiltered


@pytest.mark.parametrize(
    "query",
    [{"size": 201}, {"page": 0}, {"q": "x" * 129}, {"category": "unknown"}],
)
async def test_builtin_catalog_rejects_invalid_bounded_queries(
    app_client: httpx.AsyncClient, query: dict[str, int | str]
) -> None:
    assert (await app_client.get(URL, params=query)).status_code == 400


async def test_builtin_catalog_requires_modeling_view(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    assert (
        await app_client.get(URL, headers=sign(("modeling:manage",)))
    ).status_code == 403
    assert (
        await app_client.get(URL, headers={"X-Auth-Sig": ""})
    ).status_code == 401
