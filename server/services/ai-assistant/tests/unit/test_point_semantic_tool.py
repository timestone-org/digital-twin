"""辅助配置点位工具复用平台语义排序、权限与降级状态。"""

from collections.abc import Callable

import httpx
import pytest

from ai_assistant.apps.chat.services.tools.providers.server import ServerTools
from ai_assistant.upstream import PlatformClient, PlatformUnavailable

HEADERS = {"X-Auth-User-Id": "user", "X-Auth-Sig": "signature"}


def match(code: str, score: float) -> dict[str, object]:
    return {
        "id": code,
        "node_key": f"source:{code}",
        "code": code,
        "name": "动力储罐测温",
        "description": "热回收蓄水罐的测温探头",
        "source_id": "source",
        "source_name": "能源站",
        "unit": "℃",
        "is_enabled": True,
        "is_exact": False,
        "score": score,
    }


def tools_for(
    handler: Callable[[httpx.Request], httpx.Response],
) -> ServerTools:
    client = PlatformClient(base_url="http://platform.test", timeout_s=5)
    client.use_transport(httpx.MockTransport(handler))
    return ServerTools(platform=client, headers=HEADERS)


def response(data: object) -> httpx.Response:
    return httpx.Response(
        200, json={"code": 0, "message": "ok", "trace_id": "t", "data": data}
    )


async def test_semantic_search_keeps_platform_ranking() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v1/platform/collect-point-matches"
        assert dict(request.url.params) == {
            "q": "余热回收水箱温度",
            "source_id": "source",
            "limit": "6",
        }
        for key, value in HEADERS.items():
            assert request.headers[key] == value
        assert request.headers["traceparent"]
        assert request.extensions["timeout"]["read"] == 15
        return response(
            {
                "items": [match("z", 0.9), match("a", 0.8)],
                "mode": "hybrid",
                "pending_count": 0,
                "note": None,
            }
        )

    got = await tools_for(handler)(
        "points.search",
        {"keyword": "  余热回收水箱温度  ", "source_id": "source"},
    )
    assert [point["code"] for point in got["points"]] == ["z", "a"]
    assert got["points"][0]["description"] == "热回收蓄水罐的测温探头"
    assert got["points"][0]["source_name"] == "能源站"
    assert got["mode"] == "hybrid"


@pytest.mark.parametrize(
    ("mode", "pending", "note"),
    [
        ("keyword", 2, "语义检索暂不可用，本次仅按关键词查找"),
        ("hybrid", 2, "有2个点位正在等待语义索引"),
    ],
)
async def test_search_preserves_degraded_and_pending_state(
    mode: str, pending: int, note: str
) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return response(
            {"items": [], "mode": mode, "pending_count": pending, "note": note}
        )

    got = await tools_for(handler)("points.search", {"keyword": "温度"})
    assert got["points"] == []
    assert got["mode"] == mode
    assert got["pending_count"] == pending
    assert got["note"] == note


@pytest.mark.parametrize(
    ("limit", "expected"),
    [(1, "1"), (12, "12"), (50, "12"), (0, "6"), (True, "6")],
)
async def test_search_limit_respects_platform_bounds(
    limit: object, expected: str
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["limit"] == expected
        assert "source_id" not in request.url.params
        return response({"items": [], "mode": "hybrid", "pending_count": 0})

    await tools_for(handler)(
        "points.search", {"keyword": "温度", "limit": limit}
    )


@pytest.mark.parametrize(
    "data",
    [{"items": []}, {"items": [{}], "mode": "hybrid", "pending_count": 0}],
)
async def test_malformed_semantic_results_fail_instead_of_appearing_empty(
    data: object,
) -> None:
    with pytest.raises(PlatformUnavailable):
        await tools_for(lambda _: response(data))(
            "points.search", {"keyword": "温度"}
        )


@pytest.mark.parametrize("status", [403, 503])
async def test_search_http_failure_is_not_an_empty_result(status: int) -> None:
    with pytest.raises(PlatformUnavailable):
        await tools_for(lambda _: httpx.Response(status))(
            "points.search", {"keyword": "温度"}
        )


async def test_search_timeout_is_not_retried() -> None:
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.path)
        raise httpx.ReadTimeout("timeout", request=request)

    with pytest.raises(PlatformUnavailable):
        await tools_for(handler)("points.search", {"keyword": "温度"})
    assert seen == ["/api/v1/platform/collect-point-matches"]


async def test_long_query_is_rejected_before_request() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        pytest.fail("超长输入不应请求上游")

    with pytest.raises(ValueError, match="300"):
        await tools_for(handler)("points.search", {"keyword": "温" * 301})
