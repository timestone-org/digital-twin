"""模块清单两侧一致：服务端这份是前端构建期的导出产物，不是第二个真源。

⚠ 这份重复是**有意的**（ADR-0012 五）：渲染组件与 manifest 同处一地才不会漂，
而 Agent 又必须在服务端读得到清单。漏了这道测试，Agent 会按过期清单生成配置，
而配置在前端渲染成空白——正是本设计想消灭的那类静默故障换了个位置。
"""

import json
import re
from pathlib import Path
from typing import Any, get_args

from platform_server.apps.dashboard.schemas.module_type import (
    BindingDataType,
    ChromeKeyType,
    ConfigFieldSpan,
    ConfigFieldType,
    ModuleChrome,
    ModuleRegion,
)
from platform_server.apps.dashboard.services.module_catalog import CATALOG_FILE
from platform_server.apps.dashboard.source_kinds import (
    COMPUTE_OPS,
    SOURCE_KINDS,
)

ROOT = Path(__file__).resolve().parents[5]
CONTRACTS = ROOT / "web" / "packages" / "contracts" / "src"
_UNION = re.compile(
    r"export const (?P<name>\w+) = \[(?P<body>[^\]]*)\] as const", re.DOTALL
)
_MEMBER = re.compile(r"'([^']+)'")
# `CHROME_KEYS` 是一张对象表，不是 `_UNION` 认的那种字符串联合，故单挑它的键名
_CHROME_KEY = re.compile(r"\{\s*key:\s*'([^']+)'")

# 已登记的模块：两个钉位/通用容器、两个装饰块、一个纯配置页头、
# 一个带 3D 资源与数组绑定、一张按文档序钉行的 2D 孪生画面，
# 以及五个多点位模块（一块摆几个读数的、一块摆一网格卡片的、一块摆一列行的、
# 一块摆一组带量程仪表的，以及一块直通渲染后端推来的成品文本流的）
EXPECTED_TYPES = frozenset(
    {
        "action-button",
        "container",
        "data-card",
        "footer",
        "gauge-card",
        "header",
        "info-card",
        "info-feed",
        "info-list",
        "image-block",
        "nav-tabs",
        "pie-chart",
        "text-block",
        "twin-2d-view",
        "twin-view",
    }
)

# 一段合格描述的字数下限，与前端 tests/description.contract.spec.ts 同值
MIN_DESCRIPTION_LENGTH = 60


def frontend_unions(file_name: str) -> dict[str, frozenset[str]]:
    """把 `@dt/contracts` 里的闭合联合读成集合。

    Args: file_name。
    """
    text = (CONTRACTS / file_name).read_text(encoding="utf-8")
    return {
        match.group("name"): frozenset(_MEMBER.findall(match.group("body")))
        for match in _UNION.finditer(text)
    }


def catalog_json() -> dict[str, Any]:
    """直接读提交进仓的清单文件，不经服务端的装载器。"""
    parsed: dict[str, Any] = json.loads(
        CATALOG_FILE.read_text(encoding="utf-8")
    )
    return parsed


def walk_config_fields(fields: list[Any]) -> list[dict[str, Any]]:
    """把配置字段连同它的子字段摊平。

    Args: fields。
    """
    flat: list[dict[str, Any]] = []
    for field in fields:
        flat.append(field)
        flat.extend(walk_config_fields(field.get("item_schema") or []))
        flat.extend(walk_config_fields(field.get("fields") or []))
    return flat


def walk_bindings(specs: list[Any]) -> list[dict[str, Any]]:
    """把绑定槽连同数组子槽摊平。

    Args: specs。
    """
    flat: list[dict[str, Any]] = []
    for spec in specs:
        flat.append(spec)
        flat.extend(walk_bindings(spec.get("array_fields") or []))
    return flat


def test_the_committed_catalog_holds_the_first_phase_modules() -> None:
    types = {module["type"] for module in catalog_json()["modules"]}
    assert types == EXPECTED_TYPES


def test_every_committed_module_carries_a_description() -> None:
    """产物里每个模块都得带那段给模型读的说明。

    ⚠ 前端那道闸只管清单，本条管的是**落到服务端这份产物**里的结果：
    忘了重跑生成、或序列化那一步漏了这一键时，Agent 读到的名片上就没有它，
    而模块本身照常渲染、没有任何一处报错。
    """
    thin = [
        module["type"]
        for module in catalog_json()["modules"]
        if len(module.get("description") or "") < MIN_DESCRIPTION_LENGTH
    ]
    assert thin == []


def test_the_config_field_types_match_the_frontend_union() -> None:
    unions = frontend_unions("module.ts")
    assert set(get_args(ConfigFieldType)) == unions["CONFIG_FIELD_TYPES"]


def test_the_field_spans_match_the_frontend_union() -> None:
    unions = frontend_unions("module.ts")
    assert set(get_args(ConfigFieldSpan)) == unions["CONFIG_FIELD_SPANS"]


def test_the_binding_data_types_match_the_frontend_union() -> None:
    unions = frontend_unions("module.ts")
    assert set(get_args(BindingDataType)) == unions["BINDING_DATA_TYPES"]


def test_the_module_chromes_match_the_frontend_union() -> None:
    unions = frontend_unions("module.ts")
    assert set(get_args(ModuleChrome)) == unions["MODULE_CHROMES"]


def test_the_module_regions_match_the_frontend_union() -> None:
    unions = frontend_unions("module.ts")
    assert set(get_args(ModuleRegion)) == unions["MODULE_REGIONS"]


def test_the_source_kinds_match_the_frontend_union() -> None:
    unions = frontend_unions("binding.ts")
    assert set(SOURCE_KINDS) == unions["BINDING_SOURCE_KINDS"]


def test_the_compute_operators_match_the_frontend_union() -> None:
    unions = frontend_unions("binding.ts")
    assert set(COMPUTE_OPS) == unions["COMPUTE_OPS"]


def test_every_config_field_uses_a_registered_control_type() -> None:
    known = set(get_args(ConfigFieldType))
    used = {
        field["type"]
        for module in catalog_json()["modules"]
        for field in walk_config_fields(module["config_schema"])
    }
    assert used <= known


def test_every_binding_slot_uses_a_registered_data_type() -> None:
    known = set(get_args(BindingDataType))
    used = {
        spec["data_type"]
        for module in catalog_json()["modules"]
        for spec in walk_bindings(module["bindings"])
    }
    assert used <= known


def test_array_slots_declare_their_sub_slots() -> None:
    empty = [
        f"{module['type']}.{spec['key']}"
        for module in catalog_json()["modules"]
        for spec in module["bindings"]
        if spec.get("is_array") and not spec.get("array_fields")
    ]
    assert empty == []


def test_the_page_head_module_pins_itself_to_the_header_region() -> None:
    header = next(
        module
        for module in catalog_json()["modules"]
        if module["type"] == "header"
    )
    assert header["region"] == "header"
    assert header["bindings"] == []


def test_the_twin_module_declares_the_array_slot_the_editor_needs() -> None:
    twin = next(
        module
        for module in catalog_json()["modules"]
        if module["type"] == "twin-view"
    )
    anchors = next(
        spec for spec in twin["bindings"] if spec["key"] == "anchorValues"
    )
    assert anchors["is_array"] is True
    assert [item["key"] for item in anchors["array_fields"]] == ["value"]


def test_no_two_modules_claim_the_same_type() -> None:
    types = [module["type"] for module in catalog_json()["modules"]]
    assert sorted(types) == sorted(set(types))


def test_config_field_keys_are_unique_inside_a_module() -> None:
    duplicated = [
        module["type"]
        for module in catalog_json()["modules"]
        if len({field["key"] for field in module["config_schema"]})
        != len(module["config_schema"])
    ]
    assert duplicated == []


def test_the_committed_catalog_carries_both_type_legends() -> None:
    """产物里带着两张给模型读的图例，且逐档铺满。

    ⚠ 模型没有属性面板可看：`type: "enum"` 那一格该写 `options[].value` 里的
    哪一个、`type: "image"` 接不接 CSS 渐变，只有图例说得出来。漏了这一段，
    Agent 写进去的值形状不对，而值存得下去、也不报错。
    """
    catalog = catalog_json()
    field_docs = {row["type"] for row in catalog["field_types"]}
    data_docs = {row["type"] for row in catalog["binding_data_types"]}

    assert field_docs == set(get_args(ConfigFieldType))
    assert data_docs == set(get_args(BindingDataType))
    assert all(
        len(row["doc"]) > 10
        for row in catalog["field_types"] + catalog["binding_data_types"]
    )


def test_every_sub_editor_points_at_a_declared_config_key() -> None:
    """子编辑器接管的那个键必须真在配置字段里。

    ⚠ 指错键的话属性面板永远开不出那个入口，而清单本身看着完全正常。
    """
    offenders = [
        f"{module['type']}.{module['sub_editor']['config_key']}"
        for module in catalog_json()["modules"]
        if module.get("sub_editor")
        and module["sub_editor"]["config_key"]
        not in {field["key"] for field in module["config_schema"]}
    ]
    assert offenders == []


def test_preset_ids_are_unique_inside_a_module() -> None:
    """一个模块里预设 id 不重名——重名时按 id 取那一套永远取到头一个。"""
    duplicated = [
        module["type"]
        for module in catalog_json()["modules"]
        if len({one["id"] for one in module.get("config_presets") or []})
        != len(module.get("config_presets") or [])
    ]
    assert duplicated == []


def test_presets_only_touch_keys_the_module_actually_has() -> None:
    """预设写的键要么在配置字段里，要么是外观那一段。

    ⚠ 预设是**浅合并落库**的一笔：写进去一个模块不认识的键，值存得下去、
    也不报错，用户点了按钮却只得到半套观感。
    """
    # 模块级卡片外观住在配置袋子的这一段，不在 config_schema 里
    card_style = "__cardStyle"
    offenders: list[str] = []
    for module in catalog_json()["modules"]:
        known = {field["key"] for field in module["config_schema"]}
        known.add(card_style)
        for preset in module.get("config_presets") or []:
            offenders.extend(
                f"{module['type']}.{preset['id']}.{key}"
                for key in preset["config"]
                if key not in known
            )
    assert offenders == []


def frontend_chrome_keys() -> frozenset[str]:
    """`@dt/contracts` 里登记的全部外壳键名。"""
    text = (CONTRACTS / "chrome.ts").read_text(encoding="utf-8")
    return frozenset(_CHROME_KEY.findall(text))


def test_the_committed_catalog_carries_the_chrome_key_vocabulary() -> None:
    """产物里的外壳词汇表与前端逐字相同。

    ⚠ 服务端校验一条卡片样式的外壳段只有这一份依据：漏了这一段，样式里写进
    一个不存在的键，值存得下去、渲染时静默不注入变量——用户看到的是「存下来的
    样式套上去少了一半」，而两侧都不报错。
    """
    catalog = catalog_json()
    keys = {row["key"] for row in catalog["chrome_keys"]}

    assert keys == frontend_chrome_keys()
    assert keys


def test_every_chrome_key_declares_the_shape_of_its_value() -> None:
    """每个外壳键的 `type` 是登记过的一档，且只有 `enum` 带取值白名单。

    ⚠ 非枚举键带上 `values` 会让校验侧把一个自由数值收成白名单内的几个串；
    枚举键缺了 `values` 则等于放行任何字符串——两种都只在运行期表现为
    「配了没反应」。
    """
    known = set(get_args(ChromeKeyType))
    offenders = [
        row["key"]
        for row in catalog_json()["chrome_keys"]
        if row["type"] not in known
        or (row["type"] == "enum") != bool(row.get("values"))
    ]
    assert offenders == []


def test_content_keys_only_name_keys_the_module_actually_has() -> None:
    """内容键必须真在该模块的顶层配置字段里。

    ⚠ 观感键是「顶层键减去内容键」算出来的：内容键写错一个字，那个真正的内容
    键就落进观感键里，被一条卡片样式存下来、套用时把别人配好的格整片抹掉。
    """
    offenders = [
        f"{module['type']}.{key}"
        for module in catalog_json()["modules"]
        for key in module.get("content_keys") or []
        if key not in {field["key"] for field in module["config_schema"]}
    ]
    assert offenders == []
