"""模块清单的装载与槽键解析：清单坏了要响亮失败，不静默变成空目录。"""

from pathlib import Path

import pytest

from platform_server.apps.dashboard.errors import ModuleCatalogUnreadable
from platform_server.apps.dashboard.services import module_catalog
from platform_server.apps.dashboard.services.module_catalog import (
    load_module_catalog,
    parse_field_key,
)


def test_the_committed_catalog_registers_the_first_phase_modules() -> None:
    catalog = load_module_catalog()
    assert catalog.known_types() == frozenset(
        {
            "container",
            "footer",
            "header",
            "image-block",
            "text-block",
            "twin-view",
        }
    )


def test_an_unknown_type_has_no_manifest() -> None:
    assert load_module_catalog().find("gauge-chart") is None


def test_slots_split_scalar_and_array_entries() -> None:
    slots = load_module_catalog().slots("twin-view")
    assert slots.scalar_keys == frozenset({"scene_status"})
    assert slots.array_fields == {"hotspots": frozenset({"value", "state"})}


def test_an_unknown_type_has_no_slots() -> None:
    slots = load_module_catalog().slots("gauge-chart")
    assert slots.scalar_keys == frozenset()
    assert slots.array_fields == {}


def test_a_scalar_key_parses_without_an_index() -> None:
    parsed = parse_field_key("scene_status")
    assert parsed is not None
    assert (parsed.slot, parsed.array_index, parsed.sub_key) == (
        "scene_status",
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
