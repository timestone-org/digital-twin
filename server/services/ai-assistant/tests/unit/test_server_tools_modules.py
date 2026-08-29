"""模块清单工具的两半：整表给名片，点名给全表。

守的是「读得到才配得对」。整份清单六万多字符，一次给不得，所以分两步：
名片认模块、展开配字段。而**展开那一步不是原样透传**——上游的详情里带着整套
预设（一个模块能有一万多字符），收窄成「字段全表 + 图例 + 预设索引」，
要某一套预设的值再带 `preset` 调一次。

⚠ 这一组里几乎每一条守的都是静默故障：图例漏了，模型只能猜每一格该写什么
形状的值；预设值全塞进去，技能正文与工具结果被挤出上下文；子编辑器那一段
不点名，模型照猜着往里写，而写进去既不报错也不渲染。
"""

from collections.abc import Callable

import httpx

from ai_assistant.apps.chat.services.server_tools import ServerTools
from ai_assistant.upstream import PlatformClient

Handler = Callable[[httpx.Request], httpx.Response]

HEADERS = {"X-Auth-User-Id": "u1", "X-Auth-Sig": "s1"}


def _tools(handler: Handler) -> ServerTools:
    client = PlatformClient(base_url="http://platform.test", timeout_s=5)
    client.use_transport(httpx.MockTransport(handler))
    return ServerTools(platform=client, headers=dict(HEADERS))


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
                "is_entity_pinned": True,
                "array_fields": [
                    {"key": "value", "label": "值", "data_type": "number"},
                    {"key": "time", "label": "时刻", "data_type": "string"},
                ],
            }
        ],
    }


# 展开一个模块时上游会把这两张图例一起给回来（ModuleTypeDetailOut）
_LEGENDS: dict[str, object] = {
    "field_types": [
        {"type": "enum", "doc": "下拉单选，值必须逐字等于 options[].value。"},
        {"type": "boolean", "doc": "开关，只认真正的 true / false。"},
    ],
    "binding_data_types": [
        {"type": "number", "doc": "数值。状态码这类数字编码也走这一档。"}
    ],
}


def _detail(module_type: str, name: str) -> dict[str, object]:
    """上游详情端点的作答：模块本体 + 预设 + 两张图例。"""
    module = _module(module_type, name)
    module["config_presets"] = [
        {
            "id": "compact",
            "label": "紧凑",
            "hint": "小字号 + 窄间距。",
            "config": {"title": "", "unit": "kW", "__cardStyle": {"pad": 4}},
        }
    ]
    module["sub_editor"] = {
        "config_key": "twin",
        "route_name": "twin-editor",
        "label": "打开孪生编辑器",
    }
    module["default_config"] = {"__cardStyle": {"corners": False}}
    return {**module, **_LEGENDS}


def _detail_handler(module_type: str, name: str) -> Handler:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith(f"/{module_type}")
        return httpx.Response(
            200,
            json={
                "code": 0,
                "message": "ok",
                "trace_id": "t",
                "data": _detail(module_type, name),
            },
        )

    return handler


async def test_the_module_list_gives_cards_not_config_fields() -> None:
    tools = _tools(_catalog([_module("info-card", "信息卡片")]))
    got = await tools("modules.catalog", {})
    assert isinstance(got, dict)
    modules = got["modules"]
    assert isinstance(modules, list)
    card = modules[0]
    # 整份清单六万多字符，塞进去会把技能正文与工具结果一起挤出上下文
    assert "config_schema" not in card
    assert card["config_field_count"] == 2
    # 子槽写成 `键:类型`：一个槽里 value 收数值、time 收字符串是常态，
    # 只给键名的话模型只能按父槽的类型去理解每一个子槽
    assert card["slots"][0]["array_fields"] == ["value:number", "time:string"]
    # 行钉在配置项上还是由绑定条数决定，是两种完全不同的写法
    assert card["slots"][0]["is_entity_pinned"] is True


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
    got = await _tools(_detail_handler("info-card", "信息卡片"))(
        "modules.catalog", {"module_type": "info-card"}
    )
    assert isinstance(got, dict)
    assert got["config_schema"] == [{"key": "title"}, {"key": "unit"}]


async def test_the_expansion_carries_the_type_legends() -> None:
    """展开时把「每一档 type 该写什么形状的值」一起给。

    ⚠ 模型没有属性面板可看：`type: "enum"` 那一格该写 options 里的哪一个、
    `type: "image"` 接不接 CSS 渐变，只有图例说得出来。少了它，模型写进去的
    值形状不对，而值存得下去、也不报错，画面上表现为「配了没反应」。
    """
    got = await _tools(_detail_handler("info-card", "信息卡片"))(
        "modules.catalog", {"module_type": "info-card"}
    )
    assert isinstance(got, dict)
    kinds = {row["type"] for row in got["field_types"]}
    assert kinds == {"enum", "boolean"}
    assert [row["type"] for row in got["binding_data_types"]] == ["number"]


async def test_the_expansion_lists_presets_without_their_values() -> None:
    """预设只给目录页：八套预设一万多字符，而模型多半只用其中一套。"""
    got = await _tools(_detail_handler("info-card", "信息卡片"))(
        "modules.catalog", {"module_type": "info-card"}
    )
    assert isinstance(got, dict)
    assert got["presets"] == [
        {"id": "compact", "label": "紧凑", "hint": "小字号 + 窄间距。"}
    ]
    assert "config" not in got["presets"][0]
    assert "preset=" in got["note"]


async def test_naming_a_preset_pulls_that_one_whole_config() -> None:
    got = await _tools(_detail_handler("info-card", "信息卡片"))(
        "modules.catalog", {"module_type": "info-card", "preset": "compact"}
    )
    assert isinstance(got, dict)
    preset = got["preset"]
    assert isinstance(preset, dict)
    assert preset["config"]["unit"] == "kW"
    # 外观那一段也在预设里，写它的路径不一样，note 得说清
    assert "__cardStyle" in preset["config"]
    assert "浅合并" in got["note"]


async def test_an_unknown_preset_id_answers_with_the_menu() -> None:
    """记岔了 id 时给可选清单，不给空表。

    ⚠ 回一张空表，模型就以为这个模块没有预设，转头去逐个字段凑那套观感。
    """
    got = await _tools(_detail_handler("info-card", "信息卡片"))(
        "modules.catalog", {"module_type": "info-card", "preset": "没有这个"}
    )
    assert isinstance(got, dict)
    assert got["preset"] is None
    assert [one["id"] for one in got["presets"]] == ["compact"]


async def test_the_expansion_flags_the_segment_a_sub_editor_owns() -> None:
    """子编辑器接管的那一段要点名。

    ⚠ 那一段的形状不在清单里：模型照猜着往里写，值存得下去、也不报错，
    画面上一点变化都没有。
    """
    got = await _tools(_detail_handler("twin-view", "数字孪生"))(
        "modules.catalog", {"module_type": "twin-view"}
    )
    assert isinstance(got, dict)
    assert got["sub_editor"]["config_key"] == "twin"
    assert "sub_editor" in got["note"]


async def test_the_expansion_carries_the_seeded_factory_config() -> None:
    """出厂就落库的那几个键要给：它与字段的 default 不是一回事。"""
    got = await _tools(_detail_handler("info-card", "信息卡片"))(
        "modules.catalog", {"module_type": "info-card"}
    )
    assert isinstance(got, dict)
    assert got["default_config"] == {"__cardStyle": {"corners": False}}


async def test_the_keyword_filters_by_chinese_name_and_alias() -> None:
    tools = _tools(
        _catalog(
            [
                _module("info-card", "信息卡片"),
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
    tools = _tools(_catalog([_module("info-card", "信息卡片")]))
    got = await tools("modules.catalog", {"keyword": "毫不相干"})
    assert isinstance(got, dict)
    assert len(got["modules"]) == 1


def _described(module_type: str, name: str, said: str) -> dict[str, object]:
    body = _module(module_type, name)
    body["description"] = said
    return body


async def test_a_narrowed_card_says_what_the_module_is_for() -> None:
    """模型分不清 info-card 与 info-card，靠的就是这一段。"""
    tools = _tools(
        _catalog(
            [
                _described("info-card", "信息卡片", "一块摆 1..N 个读数。"),
                _described("text-block", "文本块", "一段死文字。"),
            ]
        )
    )

    got = await tools("modules.catalog", {"keyword": "信息卡片"})
    assert isinstance(got, dict)
    modules = got["modules"]
    assert isinstance(modules, list)
    assert modules[0]["description"] == "一块摆 1..N 个读数。"


async def test_the_whole_table_stays_lean_and_says_where_to_get_more() -> None:
    """说明每条 3–6 句，整表带上就把技能正文与工具结果挤出去了。"""
    tools = _tools(
        _catalog(
            [
                _described("info-card", "信息卡片", "一块摆 1..N 个读数。"),
                _described("text-block", "文本块", "一段死文字。"),
            ]
        )
    )

    got = await tools("modules.catalog", {})
    assert isinstance(got, dict)
    modules = got["modules"]
    assert isinstance(modules, list)
    assert all("description" not in one for one in modules)
    assert "keyword" in str(got["note"])


async def test_a_module_without_keywords_is_still_searchable_by_name() -> None:
    bare = _module("info-card", "信息卡片")
    bare["keywords"] = None
    tools = _tools(_catalog([bare]))

    got = await tools("modules.catalog", {"keyword": "信息卡片"})
    assert isinstance(got, dict)
    modules = got["modules"]
    assert isinstance(modules, list)
    assert modules[0]["type"] == "info-card"


async def test_a_module_without_a_description_gets_none_invented() -> None:
    """编出来的说明会被当成事实，照着它去配一个并不存在的槽。"""
    tools = _tools(_catalog([_module("info-card", "信息卡片")]))

    got = await tools("modules.catalog", {"keyword": "信息卡片"})
    assert isinstance(got, dict)
    modules = got["modules"]
    assert isinstance(modules, list)
    assert "description" not in modules[0]


async def test_a_card_carries_every_flag_that_changes_how_a_slot_is_fed() -> (
    None
):
    """必绑、时序、枚举映射这三格出现在名片上。

    ⚠ 三格各自漏掉的表现都不一样，且都不报错：漏了 `is_required`，模型不知道
    这个槽不绑整块就是 unbound；漏了 `is_time_series`，它不知道这个槽还能拿到
    历史序列（而只有 opcua / archive 有真实历史）；漏了 `enum_map`，它会照着
    数值去理解一个早已被换成文案的值。
    """
    module = _module("info-list", "信息列表")
    module["bindings"] = [
        {
            "key": "trend",
            "label": "趋势",
            "data_type": "number",
            "is_required": True,
            "is_time_series": True,
        },
        {
            "key": "state",
            "label": "状态",
            "data_type": "enum",
            "enum_map": {"0": "离线", "1": "运行"},
        },
    ]
    got = await _tools(_catalog([module]))("modules.catalog", {})
    assert isinstance(got, dict)
    modules = got["modules"]
    assert isinstance(modules, list)
    trend, state = modules[0]["slots"]

    assert trend["is_required"] is True
    assert trend["is_time_series"] is True
    # 标量槽没有行，`is_entity_pinned` 对它没有意义，不摆出来占地方
    assert "is_entity_pinned" not in trend
    assert state["enum_map"] == {"0": "离线", "1": "运行"}


async def test_a_sub_slot_without_a_type_is_listed_by_key_alone() -> None:
    """上游没给子槽类型时只给键名。

    ⚠ 不许写一个 `None` 上去：那一串会被模型当成「这个子槽的类型叫 None」，
    照着它去猜值的形状。
    """
    module = _module("info-card", "信息卡片")
    module["bindings"] = [
        {
            "key": "itemValues",
            "label": "读数",
            "data_type": "number",
            "is_array": True,
            "array_fields": [{"key": "value", "label": "值"}],
        }
    ]
    got = await _tools(_catalog([module]))("modules.catalog", {})
    assert isinstance(got, dict)
    modules = got["modules"]
    assert isinstance(modules, list)

    assert modules[0]["slots"][0]["array_fields"] == ["value"]
