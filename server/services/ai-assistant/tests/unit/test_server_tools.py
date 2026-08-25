"""服务端工具的分派。

守的是「认不出的名字要抛」：模型编一个不存在的工具名是常事，静默给它一个空
结果，它会当成「查过了，没有」继续往下走，最后给用户一个自信的错误答案。
"""

import json
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


async def test_the_card_says_whether_it_holds_children() -> None:
    """装不装得下子节点要在名片上。

    ⚠ 缺了它模型只能挑一个试、被编辑器拒、再换一个——三次往返换一个
    本可以不发生的错误。
    """
    holder = _module("container", "容器")
    holder["is_container"] = True
    holder["region"] = None
    tools = _tools(_catalog([holder]))

    got = await tools("modules.catalog", {})
    assert isinstance(got, dict)
    modules = got["modules"]
    assert isinstance(modules, list)
    assert modules[0]["is_container"] is True


async def test_a_pinned_module_says_which_region_it_lives_in() -> None:
    header = _module("header", "页头")
    header["region"] = "header"
    tools = _tools(_catalog([header]))

    got = await tools("modules.catalog", {})
    assert isinstance(got, dict)
    modules = got["modules"]
    assert isinstance(modules, list)
    # 页头页脚每屏只有一个、且横向铺满——摆之前就该知道
    assert modules[0]["region"] == "header"


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


def _functions(rows: list[dict[str, object]]) -> Handler:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "code": 0,
                "message": "ok",
                "trace_id": "t",
                "data": {
                    "categories": [{"value": "math", "label": "数学"}],
                    "functions": rows,
                    "operators": [],
                    "window_units": [],
                    "rules": ["四则运算里任一值为空，整条为空"],
                    "columns": [{"key": "本期", "name": "本期值"}],
                    "tables": [],
                    "library": ["同比增长率"],
                },
            },
        )

    return handler


def _function(name: str, description: str) -> dict[str, object]:
    return {
        "name": name,
        "category": "series",
        "signature": f"{name}(x, n)",
        "description": description,
        "example": f"{name}({{本期}}, 1)",
        "args": ["x", "步数"],
        "min_args": 1,
        "max_args": 2,
    }


async def test_the_function_list_starts_without_examples() -> None:
    tools = _tools(_functions([_function("PREV", "取前若干行的值")]))
    got = await tools("formula.catalog", {"table_id": "t1"})
    assert isinstance(got, dict)
    functions = got["functions"]
    assert isinstance(functions, list)
    assert "example" not in functions[0]
    assert functions[0]["signature"] == "PREV(x, n)"


async def test_the_nine_evaluation_rules_are_never_dropped() -> None:
    # 它们全是「错了不报错、只是算出来的数不对」那一类
    tools = _tools(_functions([_function("PREV", "取前若干行的值")]))
    got = await tools("formula.catalog", {"table_id": "t1"})
    assert isinstance(got, dict)
    assert got["rules"] == ["四则运算里任一值为空，整条为空"]
    assert got["columns"] == [{"key": "本期", "name": "本期值"}]


async def test_a_keyword_narrows_to_matches_and_adds_the_examples() -> None:
    tools = _tools(
        _functions(
            [_function("PREV", "取前若干行的值"), _function("SUM", "求和")]
        )
    )
    got = await tools("formula.catalog", {"table_id": "t1", "keyword": "求和"})
    assert isinstance(got, dict)
    functions = got["functions"]
    assert isinstance(functions, list)
    assert [one["name"] for one in functions] == ["SUM"]
    assert functions[0]["example"] == "SUM({本期}, 1)"


async def test_a_keyword_that_matches_nothing_says_do_not_invent_one() -> None:
    tools = _tools(_functions([_function("PREV", "取前若干行的值")]))
    got = await tools("formula.catalog", {"table_id": "t1", "keyword": "涨跌"})
    assert isinstance(got, dict)
    assert got["functions"] == []
    assert "不要自己编" in str(got["note"])


async def test_a_broken_formula_comes_back_as_an_answer_not_a_failure() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/formula:validate")
        return httpx.Response(
            200,
            json={
                "code": 0,
                "message": "ok",
                "trace_id": "t",
                "data": {"is_ok": False, "error": "未知函数 FOO"},
            },
        )

    got = await _tools(handler)(
        "formula.validate", {"table_id": "t1", "formula": "FOO(1)"}
    )
    # 当成调用失败的话，助手会以为是自己这一侧坏了
    assert got == {"is_ok": False, "error": "未知函数 FOO"}


async def test_a_trial_run_carries_the_sample_values_over() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["values"] == {"本期": 120}
        assert body["column_key"] == "增量"
        return httpx.Response(
            200,
            json={
                "code": 0,
                "message": "ok",
                "trace_id": "t",
                "data": {"is_ok": True, "value": 20, "history_refs": ["PREV"]},
            },
        )

    got = await _tools(handler)(
        "formula.preview",
        {
            "table_id": "t1",
            "formula": "{本期} - PREV({本期}, 1)",
            "column_key": "增量",
            "values": {"本期": 120},
        },
    )
    assert isinstance(got, dict)
    assert got["value"] == 20


async def test_a_trial_run_without_sample_values_still_sends_the_grid() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert json.loads(request.content)["values"] == {}
        return httpx.Response(
            200,
            json={
                "code": 0,
                "message": "ok",
                "trace_id": "t",
                "data": {"is_ok": True, "value": None},
            },
        )

    got = await _tools(handler)(
        "formula.preview", {"table_id": "t1", "formula": "{本期}"}
    )
    assert isinstance(got, dict)
    assert got["is_ok"] is True


async def test_a_missing_table_id_is_refused_before_the_call() -> None:
    # 空串会拼出 `/dataset-tables//...`，回来的 404 与「台账不存在」一模一样
    with pytest.raises(UnknownServerTool):
        await _tools(_functions([]))("formula.catalog", {})
