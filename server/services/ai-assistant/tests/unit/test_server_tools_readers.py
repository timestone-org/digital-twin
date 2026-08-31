"""跨模块只读工具的分派与收窄（V2_PLAN §3 的读侧第一批）。

守的是两件事：上游返回**逐字段窄化**（多一个字段不要紧，少一个会在下游崩成
None）；清单截断与「真的没有」都要**说出来**，不许静默。
"""

from collections.abc import Callable

import httpx
import pytest

from ai_assistant.apps.chat.services.tools.providers.server import (
    ServerTools,
    UnknownServerTool,
)
from ai_assistant.upstream import PlatformClient

Handler = Callable[[httpx.Request], httpx.Response]

HEADERS = {"X-Auth-User-Id": "u1", "X-Auth-Sig": "s1"}


def _pages(batches: list[list[object]]) -> Handler:
    """按调用次序逐页作答，问完就一直给空页。"""
    served = iter(batches)

    def handler(_request: httpx.Request) -> httpx.Response:
        items = next(served, [])
        return httpx.Response(
            200,
            json={
                "code": 0,
                "message": "ok",
                "trace_id": "t",
                "data": {
                    "items": items,
                    "page": 1,
                    "size": 200,
                    "total": len(items),
                },
            },
        )

    return handler


def _tools(handler: Handler) -> ServerTools:
    client = PlatformClient(base_url="http://platform.test", timeout_s=5)
    client.use_transport(httpx.MockTransport(handler))
    return ServerTools(platform=client, headers=dict(HEADERS))


SOURCE_ID = "0198c0de-0000-7000-8000-0000000000aa"


def _listing(rows: list[object]) -> Handler:
    """data 直接是数组的响应（素材列表、列清单）。"""

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"code": 0, "message": "ok", "trace_id": "t", "data": rows},
        )

    return handler


async def test_listing_dashboards_narrows_and_passes_the_filters() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/dashboards")
        assert request.url.params["q"] == "光伏"
        assert request.url.params["project_id"] == "p1"
        return _pages(
            [
                [
                    {
                        "id": "d1",
                        "name": "光伏总览",
                        "project_id": "p1",
                        "updated_at": "2026-08-25T00:00:00Z",
                        "node_count": 12,
                        "is_public": True,
                    }
                ]
            ]
        )(request)

    got = await _tools(handler)(
        "dashboards.list", {"keyword": "光伏", "project_id": "p1"}
    )
    assert isinstance(got, dict)
    assert got["dashboards"] == [
        {
            "id": "d1",
            "name": "光伏总览",
            "project_id": "p1",
            "updated_at": "2026-08-25T00:00:00Z",
        }
    ]
    assert "已全部列出" in str(got["note"])


async def test_a_long_dashboard_list_is_clipped_and_says_so() -> None:
    # 截断不挑明，模型会把「前 20 张里没有」读成「全库没有」
    rows: list[object] = [
        {"id": f"d{i}", "name": f"屏{i}", "project_id": "p1"} for i in range(25)
    ]
    got = await _tools(_pages([rows]))("dashboards.list", {})
    assert isinstance(got, dict)
    assert len(got["dashboards"]) == 20
    assert "共 25 条" in str(got["note"])
    assert "前 20 条" in str(got["note"])


async def test_listing_tables_narrows_to_the_card_fields() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/dataset-tables")
        assert request.url.params["q"] == "光伏"
        row = {
            "id": "t1",
            "code": "pv_day",
            "name": "光伏日报",
            "collect_mode": "aggregate",
            "collect_interval_ms": 10000,
            "retention_days": 30,
            "column_count": 8,
        }
        return _pages([[row]])(request)

    got = await _tools(handler)("datasets.list_tables", {"keyword": "光伏"})
    assert isinstance(got, dict)
    assert got["tables"] == [
        {
            "id": "t1",
            "code": "pv_day",
            "name": "光伏日报",
            "collect_mode": "aggregate",
            "collect_interval_ms": 10000,
        }
    ]


async def test_reading_saved_columns_keeps_the_formula() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/dataset-tables/t1/columns")
        return _listing(
            [
                {
                    "id": "c1",
                    "table_id": "t1",
                    "key": "本期",
                    "name": "本期值",
                    "unit": "kWh",
                    "data_type": "number",
                    "source": "opcua",
                    "node_key": f"{SOURCE_ID}:K1",
                    "formula": None,
                    "agg": "avg",
                },
                {
                    "id": "c2",
                    "table_id": "t1",
                    "key": "增量",
                    "name": "增量",
                    "unit": None,
                    "data_type": "number",
                    "source": "formula",
                    "node_key": None,
                    "formula": "{本期} - PREV({本期}, 1)",
                },
            ]
        )(request)

    got = await _tools(handler)("datasets.read_columns", {"table_id": "t1"})
    assert isinstance(got, dict)
    columns = got["columns"]
    assert isinstance(columns, list)
    # 逐字段窄化：行内部的 id 与聚合口径不进上下文
    assert "id" not in columns[0]
    assert columns[0]["node_key"] == f"{SOURCE_ID}:K1"
    assert columns[1]["source"] == "formula"
    assert columns[1]["formula"] == "{本期} - PREV({本期}, 1)"


async def test_reading_saved_columns_without_a_table_id_is_refused() -> None:
    with pytest.raises(UnknownServerTool):
        await _tools(_listing([]))("datasets.read_columns", {})


async def test_searching_assets_narrows_and_passes_the_filters() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/assets")
        assert request.url.params["q"] == "泵"
        assert request.url.params["kind"] == "model"
        # 多要一条是为了判断有没有截断——上游不报总数
        assert request.url.params["limit"] == "21"
        return _listing(
            [
                {
                    "id": "a1",
                    "ref": "asset:a1",
                    "name": "水泵",
                    "kind": "model",
                    "size_bytes": 1024,
                    "variants": [
                        {
                            "variant": "light",
                            "label": "轻量",
                            "status": "ready",
                            "size_bytes": 128,
                        }
                    ],
                }
            ]
        )(request)

    got = await _tools(handler)(
        "assets.search", {"keyword": "泵", "kind": "model"}
    )
    assert isinstance(got, dict)
    assert got["assets"] == [
        {
            "id": "a1",
            "name": "水泵",
            "kind": "model",
            "variants": [{"variant": "light", "status": "ready"}],
        }
    ]


async def test_a_full_asset_window_is_reported_as_clipped() -> None:
    rows: list[object] = [
        {"id": f"a{i}", "name": f"素材{i}", "kind": "image", "variants": []}
        for i in range(21)
    ]
    got = await _tools(_listing(rows))("assets.search", {})
    assert isinstance(got, dict)
    assert len(got["assets"]) == 20
    assert "还有更多" in str(got["note"])


async def test_an_empty_asset_search_says_there_is_none() -> None:
    got = await _tools(_listing([]))("assets.search", {"keyword": "毫不相干"})
    assert isinstance(got, dict)
    assert got["assets"] == []
    assert "真的没有" in str(got["note"])


def _point_row(code: str) -> dict[str, object]:
    return {
        "id": "p1",
        "source_id": SOURCE_ID,
        "node_key": f"{SOURCE_ID}:{code}",
        "code": code,
        "name": "出口温度",
        "address": "ns=2;s=K1.T",
        "data_type": "float",
        "unit": "℃",
        "sampling_interval_ms": 1000,
        "deadband": 0.5,
        "archive_enabled": True,
        "archive_max_interval_ms": 60000,
        "archive_retention_days": None,
        "created_at": "2026-08-25T00:00:00Z",
        "updated_at": "2026-08-25T00:00:00Z",
    }


async def test_point_detail_matches_the_code_exactly() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["source_id"] == SOURCE_ID
        assert request.url.params["q"] == "K1_T"
        # 上游的 `q` 是模糊匹配，`K1_T10` 也会跟着回来
        return _pages([[_point_row("K1_T10"), _point_row("K1_T")]])(request)

    got = await _tools(handler)(
        "points.detail", {"node_key": f"{SOURCE_ID}:K1_T"}
    )
    assert isinstance(got, dict)
    assert got["point"] == {
        "node_key": f"{SOURCE_ID}:K1_T",
        "source_id": SOURCE_ID,
        "code": "K1_T",
        "name": "出口温度",
        "unit": "℃",
        "data_type": "float",
        "address": "ns=2;s=K1.T",
        "sampling_interval_ms": 1000,
        "deadband": 0.5,
        "archive_enabled": True,
        "archive_max_interval_ms": 60000,
        "archive_retention_days": None,
    }


async def test_a_missing_point_is_answered_not_invented() -> None:
    got = await _tools(_pages([[]]))(
        "points.detail", {"node_key": f"{SOURCE_ID}:NOPE"}
    )
    assert isinstance(got, dict)
    assert got["point"] is None
    assert "没有这个点位" in str(got["note"])


async def test_a_malformed_node_key_is_refused_before_the_call() -> None:
    # 直接拿去打上游的话，回来的是一个含糊的 422
    for node_key in ("no-colon", "not-a-uuid:K1", f"{SOURCE_ID}:"):
        with pytest.raises(UnknownServerTool):
            await _tools(_pages([[]]))("points.detail", {"node_key": node_key})


async def test_without_an_upstream_the_cross_module_reads_say_so() -> None:
    # 「本部署没接上业务面」与「查过了，没有」是两件事，不能混
    calls: list[tuple[str, dict[str, object]]] = [
        ("dashboards.list", {}),
        ("datasets.list_tables", {}),
        ("datasets.read_columns", {"table_id": "t1"}),
        ("assets.search", {}),
        ("points.detail", {"node_key": f"{SOURCE_ID}:K1"}),
    ]
    for name, arguments in calls:
        with pytest.raises(UnknownServerTool, match="业务面"):
            await ServerTools()(name, dict(arguments))
