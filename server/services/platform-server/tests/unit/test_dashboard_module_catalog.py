"""模块清单的装载与槽键解析：清单坏了要响亮失败，不静默变成空目录。"""

from pathlib import Path

import pytest

from platform_server.apps.dashboard.errors import ModuleCatalogUnreadable
from platform_server.apps.dashboard.services import module_catalog
from platform_server.apps.dashboard.services.module_catalog import (
    load_module_catalog,
    parse_field_key,
)


def test_the_committed_catalog_registers_the_known_modules() -> None:
    catalog = load_module_catalog()
    assert catalog.known_types() == frozenset(
        {
            "action-button",
            "container",
            "data-card",
            "footer",
            "gauge-card",
            "header",
            "image-block",
            "info-card",
            "info-feed",
            "info-list",
            "nav-tabs",
            "pie-chart",
            "text-block",
            "twin-2d-view",
            "twin-view",
        }
    )


def test_a_card_slot_is_an_entity_pinned_array() -> None:
    """卡片的读数槽的行钉在配置里的格上，故免掉「索引连续」那条校验。

    ⚠ 漏了这个标记的话，只绑第 2 格就会被服务端拒掉，而现象是
    「绑点面板上填好了，保存报 422」。
    """
    slots = load_module_catalog().slots("info-card")
    assert slots.array_fields == {"cardValues": frozenset({"value", "aux"})}
    assert slots.entity_pinned == frozenset({"cardValues"})


def test_the_look_keys_are_the_top_keys_minus_the_content_keys() -> None:
    """观感键 = 顶层配置键 − 清单声明的内容键。

    ⚠ 内容键（标题、格、阈值规则）跟着数据走，不跟观感走：漏减一个就会让它被
    一条卡片样式存下来，套用时把别人配好的那一格整片抹掉。
    """
    catalog = load_module_catalog()
    module = catalog.find("info-card")
    assert module is not None
    top = {field.key for field in module.config_schema}

    assert catalog.look_keys("info-card") == top - {
        "title",
        "items",
        "emptyText",
        "rules",
    }


def test_an_unregistered_module_type_has_no_look_keys() -> None:
    """⚠ 空集是「一个键都不许写」，不是「随便写」——调用方须先确认类型认得出。"""
    assert load_module_catalog().look_keys("not-a-module") == frozenset()


def test_the_chrome_vocabulary_loads_with_the_module_table() -> None:
    """外壳词汇表与模块表同一份产物、同一次装载。

    ⚠ 装不出这一段就等于服务端没有校验外壳的依据，而那时写错的键会静默存进库。
    """
    catalog = load_module_catalog()

    assert "borderStyle" in catalog.chrome_key_names()
    assert len(catalog.chrome_key_names()) == len(catalog.chrome_keys)


def test_a_module_carries_the_description_the_agent_reads() -> None:
    """名片上那段说明要装得出来。

    ⚠ 服务端漏收这一键的话，装载器会静默丢掉它——Agent 拿到的名片只剩类型名与
    关键词，于是靠模块名猜这块是干什么的，而两侧都不报错。
    """
    module = load_module_catalog().find("gauge-card")
    assert module is not None
    assert module.description is not None
    # 划界那半句是描述最要紧的部分：模型正是在这几个卡片族之间选错模块
    assert "info-card" in module.description


def test_an_unknown_type_has_no_manifest() -> None:
    assert load_module_catalog().find("gauge-chart") is None


def test_slots_split_scalar_and_array_entries() -> None:
    slots = load_module_catalog().slots("twin-view")
    assert slots.scalar_keys == frozenset()
    assert slots.array_fields == {
        "partValues": frozenset({"value"}),
        "anchorValues": frozenset({"value"}),
        "panelValues": frozenset({"value"}),
        "arrowValues": frozenset({"value"}),
        "flowValues": frozenset({"intensity", "active"}),
        "partFieldValues": frozenset({"value"}),
    }


def test_the_two_d_twin_slots_are_arrays_pinned_to_the_drawing() -> None:
    """三个槽的行钉在图文档里的节点与连线上，故免掉「索引连续」那条校验。

    ⚠ 漏了这个标记的话，图上只给第 2 个节点绑点就会被服务端拒掉，而现象是
    「绑点面板上填好了，保存报 422」。
    """
    slots = load_module_catalog().slots("twin-2d-view")
    assert slots.scalar_keys == frozenset()
    assert slots.array_fields == {
        "nodeValues": frozenset({"value"}),
        "nodeStatus": frozenset({"status"}),
        "edgeValues": frozenset({"active", "direction", "value"}),
    }
    assert slots.entity_pinned == frozenset(
        {"nodeValues", "nodeStatus", "edgeValues"}
    )


def test_an_unknown_type_has_no_slots() -> None:
    slots = load_module_catalog().slots("gauge-chart")
    assert slots.scalar_keys == frozenset()
    assert slots.array_fields == {}


def test_a_scalar_key_parses_without_an_index() -> None:
    parsed = parse_field_key("sceneStatus")
    assert parsed is not None
    assert (parsed.slot, parsed.array_index, parsed.sub_key) == (
        "sceneStatus",
        None,
        None,
    )


def test_an_array_key_parses_into_slot_index_and_sub_key() -> None:
    parsed = parse_field_key("hotspots[12].value")
    assert parsed is not None
    assert (parsed.slot, parsed.array_index, parsed.sub_key) == (
        "hotspots",
        12,
        "value",
    )


# ⚠ 槽名在前端清单里是 camelCase：解析器只认 snake_case 的话，
# `anchorValues[0].value` 会被判成「模块没有这个绑定槽」而整条保存被拒
def test_a_camel_case_slot_parses() -> None:
    parsed = parse_field_key("anchorValues[0].value")
    assert parsed is not None
    assert (parsed.slot, parsed.array_index, parsed.sub_key) == (
        "anchorValues",
        0,
        "value",
    )


def test_a_non_numeric_index_does_not_parse() -> None:
    assert parse_field_key("hotspots[a].value") is None


def test_a_missing_bracket_does_not_parse() -> None:
    assert parse_field_key("hotspots.value") is None


def test_a_slot_name_outside_the_allowed_shape_does_not_parse() -> None:
    assert parse_field_key("Hotspots[0].value") is None


def test_a_sub_key_outside_the_allowed_shape_does_not_parse() -> None:
    assert parse_field_key("hotspots[0].Value") is None


def test_a_missing_catalog_file_fails_loudly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        module_catalog, "CATALOG_FILE", Path("/nonexistent/module_types.json")
    )
    with pytest.raises(ModuleCatalogUnreadable):
        load_module_catalog()


def test_a_malformed_catalog_file_fails_loudly(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    broken = tmp_path / "module_types.json"
    broken.write_text('{"modules": [{"type": "x"}]}', encoding="utf-8")
    monkeypatch.setattr(module_catalog, "CATALOG_FILE", broken)
    with pytest.raises(ModuleCatalogUnreadable):
        load_module_catalog()
