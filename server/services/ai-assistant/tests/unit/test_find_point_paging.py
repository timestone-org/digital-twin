"""按编码精确找点位时要翻页：模糊匹配排在前面的多于一页，精确那条在后面。

守的是「库里明明有，却说没有」：`q` 是名字/编码的子串匹配，短编码（如 `5`）
能匹配上几百条，第一页里没有它不等于库里没有。
"""

import httpx
import pytest

from ai_assistant.upstream import PlatformClient, PlatformUnavailable
from ai_assistant.upstream.platform import MAX_FIND_PAGES

SIZE = 3


def _client(
    pages: dict[int, list[str]], total: int
) -> tuple[PlatformClient, list[int]]:
    asked: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        page = int(request.url.params["page"])
        asked.append(page)
        items = [{"code": code} for code in pages.get(page, [])]
        return httpx.Response(
            200,
            json={
                "code": 0,
                "message": "ok",
                "trace_id": "t",
                "data": {
                    "items": items,
                    "page": page,
                    "size": SIZE,
                    "total": total,
                },
            },
        )

    client = PlatformClient(
        base_url="http://platform.test", timeout_s=5, page_size=SIZE
    )
    client.use_transport(httpx.MockTransport(handler))
    return client, asked


async def test_the_exact_code_on_page_two_is_found() -> None:
    client, asked = _client({1: ["15", "25", "35"], 2: ["5"]}, total=4)
    got = await client.find_point({}, source_id="s", code="5")
    assert got == {"code": "5"}
    assert asked == [1, 2]


async def test_paging_stops_at_the_last_page() -> None:
    client, asked = _client({1: ["15", "25", "35"], 2: ["45"]}, total=4)
    assert await client.find_point({}, source_id="s", code="5") is None
    assert asked == [1, 2]


async def test_paging_stops_at_the_cap() -> None:
    pages = {
        page: [f"{page}-{n}" for n in ("15", "25", "35")]
        for page in range(1, 50)
    }
    client, asked = _client(pages, total=1_000)
    with pytest.raises(PlatformUnavailable, match="未完成"):
        await client.find_point({}, source_id="s", code="5")
    assert asked == list(range(1, MAX_FIND_PAGES + 1))


@pytest.mark.parametrize(
    "defect", ["repeated_code", "wrong_page", "wrong_size"]
)
async def test_inconsistent_page_cannot_complete_an_exact_search(
    defect: str,
) -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        page = int(request.url.params["page"])
        items = ["first", "second", "third"] if page == 1 else ["last"]
        if defect == "repeated_code" and page > 1:
            items = ["first"]
        return httpx.Response(
            200,
            json={
                "data": {
                    "items": [{"code": code} for code in items],
                    "total": 4,
                    "page": 1 if defect == "wrong_page" else page,
                    "size": 2 if defect == "wrong_size" else SIZE,
                }
            },
        )

    client = PlatformClient(
        base_url="http://platform.test", timeout_s=1, page_size=SIZE
    )
    client.use_transport(httpx.MockTransport(respond))
    try:
        with pytest.raises(PlatformUnavailable, match="未完成"):
            await client.find_point({}, source_id="s", code="missing")
    finally:
        await client.close()
