"""服务端工具的分派。

守的是「认不出的名字要抛」：模型编一个不存在的工具名是常事，静默给它一个空
结果，它会当成「查过了，没有」继续往下走，最后给用户一个自信的错误答案。
"""

from collections.abc import Callable

import httpx
import pytest

from ai_assistant.apps.chat.services.server_tools import (
    ServerTools,
    UnknownServerTool,
)
from ai_assistant.upstream import PlatformClient

Handler = Callable[[httpx.Request], httpx.Response]

HEADERS = {"X-Auth-User-Id": "u1", "X-Auth-Sig": "s1"}


def _row(code: str, name: str, unit: str | None = None) -> dict[str, object]:
    return {
        "node_key": f"src:{code}",
        "code": code,
        "name": name,
        "unit": unit,
        "data_type": "float",
    }


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


async def test_loading_a_skill_returns_its_full_instructions() -> None:
    result = await ServerTools()("skills.load", {"name": "dashboard-binding"})
    assert isinstance(result, dict)
    assert result["ok"] is True
    assert "## 工作顺序" in str(result["instructions"])


async def test_loading_an_unknown_skill_answers_instead_of_failing() -> None:
    # 模型多半是把名字记岔了，告诉它没有这个比让这一步失败有用
    result = await ServerTools()("skills.load", {"name": "no-such-skill"})
    assert isinstance(result, dict)
    assert result["ok"] is False


async def test_an_unknown_tool_name_is_refused_loudly() -> None:
    with pytest.raises(UnknownServerTool):
        await ServerTools()("nothing.like_this", {})


async def test_searching_points_ranks_and_explains() -> None:
    tools = _tools(
        _pages(
            [
                [
                    _row("K1_TMT_OUT_T_PI", "1号机组出口温度", "℃"),
                    _row("K1_PT_01", "进口压力", "kPa"),
                ]
            ]
        )
    )
    got = await tools("points.search", {"keyword": "出口温度"})
    assert isinstance(got, dict)
    points = got["points"]
    assert isinstance(points, list)
    assert points[0]["name"] == "1号机组出口温度"
    # `why` 直接交给模型判断该不该信这一条
    assert points[0]["why"]


async def test_searching_falls_back_to_paging_when_the_keyword_misses() -> None:
    # 后端的 `q` 只对名字与编码做子串匹配，「温度」找不到 `K1_TMT_OUT_T_PI`
    tools = _tools(_pages([[], [_row("K1_TMT_OUT_T_PI", "K1TMTOUTTPI")], []]))
    got = await tools("points.search", {"keyword": "温度"})
    assert isinstance(got, dict)
    assert len(got["points"]) == 1


async def test_a_search_that_finds_nothing_says_so_plainly() -> None:
    tools = _tools(_pages([[], []]))
    got = await tools("points.search", {"keyword": "毫不相干"})
    assert isinstance(got, dict)
    assert got["points"] == []
    # 硬凑几个出来的话，模型会从里面挑一个
    assert "真的没找到" in str(got["note"])


async def test_a_search_without_a_keyword_is_refused_gently() -> None:
    tools = _tools(_pages([[]]))
    got = await tools("points.search", {"keyword": "  "})
    assert isinstance(got, dict)
    assert got["points"] == []


async def test_listing_sources_narrows_to_what_matters() -> None:
    tools = _tools(
        _pages([[{"id": "s1", "code": "scada", "name": "保定SCADA", "x": 1}]])
    )
    got = await tools("points.list_sources", {})
    assert isinstance(got, dict)
    sources = got["sources"]
    assert isinstance(sources, list)
    assert sources[0] == {
        "id": "s1",
        "code": "scada",
        "name": "保定SCADA",
        "description": None,
    }


async def test_validating_a_dashboard_passes_the_report_through() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "code": 0,
                "message": "ok",
                "trace_id": "t",
                "data": {"is_valid": False, "issues": [{"code": "x"}]},
            },
        )

    tools = _tools(handler)
    got = await tools("dashboard.validate", {"dashboard_id": "d1"})
    assert got == {"is_valid": False, "issues": [{"code": "x"}]}


async def test_validating_without_a_dashboard_id_is_refused() -> None:
    tools = _tools(_pages([[]]))
    with pytest.raises(UnknownServerTool):
        await tools("dashboard.validate", {})


async def test_without_an_upstream_the_tools_say_they_cannot() -> None:
    # 「本部署没接上业务面」与「没有点位」是两件事，不能混
    with pytest.raises(UnknownServerTool):
        await ServerTools()("points.list_sources", {})


def _catalog(modules: list[dict[str, object]]) -> Handler:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "code": 0,
                "message": "ok",
                "trace_id": "t",
                "data": {"catalog_version": 1, "modules": modules},
            },
        )

    return handler


def _module(module_type: str, name: str) -> dict[str, object]:
    return {
        "type": module_type,
        "display_name": name,
        "category": "数据",
        "keywords": [module_type, "shuzhi"],
        "chrome": "card",
        "default_size": {"width": 320, "height": 160, "min_width": 80},
        "config_schema": [{"key": "title"}, {"key": "unit"}],
        "bindings": [
            {
                "key": "itemValues",
                "label": "读数",
                "data_type": "number",
                "is_array": True,
                "array_fields": [{"key": "value", "label": "值"}],
            }
        ],
    }


async def test_the_module_list_gives_cards_not_config_fields() -> None:
    tools = _tools(_catalog([_module("metric-card", "实时数值")]))
    got = await tools("modules.catalog", {})
    assert isinstance(got, dict)
    modules = got["modules"]
    assert isinstance(modules, list)
    card = modules[0]
    # 整份清单六万多字符，塞进去会把技能正文与工具结果一起挤出上下文
    assert "config_schema" not in card
    assert card["config_field_count"] == 2
    assert card["slots"][0]["array_fields"] == ["value"]


async def test_naming_a_module_type_pulls_its_full_schema() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/metric-card")
        return httpx.Response(
            200,
            json={
                "code": 0,
                "message": "ok",
                "trace_id": "t",
                "data": _module("metric-card", "实时数值"),
            },
        )

    got = await _tools(handler)(
        "modules.catalog", {"module_type": "metric-card"}
    )
    assert isinstance(got, dict)
    assert got["config_schema"] == [{"key": "title"}, {"key": "unit"}]


async def test_the_keyword_filters_by_chinese_name_and_alias() -> None:
    tools = _tools(
        _catalog(
            [
                _module("metric-card", "实时数值"),
                _module("text-block", "文本块"),
            ]
        )
    )
    got = await tools("modules.catalog", {"keyword": "文本"})
    assert isinstance(got, dict)
    modules = got["modules"]
    assert isinstance(modules, list)
    assert [one["type"] for one in modules] == ["text-block"]


async def test_a_keyword_that_matches_nothing_still_lists_everything() -> None:
    # 给空表模型就以为没有这个模块；而用户说的叫法与清单对不上是常事
    tools = _tools(_catalog([_module("metric-card", "实时数值")]))
    got = await tools("modules.catalog", {"keyword": "毫不相干"})
    assert isinstance(got, dict)
    assert len(got["modules"]) == 1
