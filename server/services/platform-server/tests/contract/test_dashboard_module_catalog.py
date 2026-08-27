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

# 已登记的模块：两个钉位/通用容器、两个装饰块、一个纯配置页头、
# 一个带 3D 资源与数组绑定、一张按文档序钉行的 2D 孪生画面，
# 以及三个多点位模块（一块摆几个读数的、一块摆一网格卡片的、一块摆一列行的）
EXPECTED_TYPES = frozenset(
    {
        "action-button",
        "container",
        "footer",
        "header",
        "info-card",
        "info-list",
        "metric-card",
        "image-block",
        "text-block",
        "twin-2d-view",
        "twin-view",
    }
)


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
