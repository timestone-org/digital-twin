"""绑定校验：槽键属于该模块、数组索引连续、来源闭合、点位真实存在。

⚠ 来源种类是闭合集合——放开成任意字符串的话 `opuca` 会照常入库、永不产数据。
"""

import uuid
from typing import Any

from lib.utils.ids import uuid7
from platform_server.apps.dashboard.schemas.module_type import (
    BindingSpecOut,
    ModuleDefaultSizeOut,
    ModuleTypeOut,
)
from platform_server.apps.dashboard.services.binding_rules import (
    check_field_keys,
    check_sources,
    referenced_node_keys,
)
from platform_server.apps.dashboard.services.drafts import BindingDraft
from platform_server.apps.dashboard.services.module_catalog import (
    ModuleCatalog,
)


SIZE = ModuleDefaultSizeOut(width=100, height=100)


def _list_style_module() -> ModuleTypeOut:
    """一标量槽 + 一个**列表式**数组槽：行由用户增删，索引必须连续。"""
    return ModuleTypeOut(
        type="probe-view",
        display_name="试验件",
        category="试验",
        default_size=SIZE,
        bindings=[
            BindingSpecOut(
                key="sceneStatus", label="场景状态", data_type="string"
            ),
            BindingSpecOut(
                key="hotspots",
                label="热点",
                data_type="number",
                is_array=True,
                array_fields=[
                    BindingSpecOut(
                        key="value", label="读数", data_type="number"
                    ),
                    BindingSpecOut(key="state", label="状态", data_type="enum"),
                ],
            ),
        ],
    )


def _entity_pinned_module() -> ModuleTypeOut:
    """行钉在实体上的那一类：行数由配置里的实体数决定，索引不必连续。"""
    return ModuleTypeOut(
        type="probe-scene",
        display_name="带实体的试验件",
        category="试验",
        default_size=SIZE,
        bindings=[
            BindingSpecOut(
                key="anchorValues",
                label="锚点读数",
                data_type="number",
                is_array=True,
                is_entity_pinned=True,
                array_fields=[
                    BindingSpecOut(
                        key="value", label="读数", data_type="number"
                    ),
                ],
            ),
        ],
    )


def _fixture_catalog() -> ModuleCatalog:
    """两种数组槽各一个模块，外加一个不取数的模块。

    ⚠ 刻意不读提交进仓的目录：校验规则与「此刻恰好注册了哪些模块」无关，
    读真目录会让这批用例随模块增删莫名其妙地红。
    """
    return ModuleCatalog(
        catalog_version=1,
        modules=(
            _list_style_module(),
            _entity_pinned_module(),
            ModuleTypeOut(
                type="probe-block",
                display_name="不取数的件",
                category="试验",
                default_size=SIZE,
            ),
        ),
    )


CATALOG = _fixture_catalog()
SOURCE_ID = "0192f0c0-0000-7000-8000-00000000abcd"
KNOWN_KEY = f"{SOURCE_ID}:outlet_temp"
KNOWN = frozenset({KNOWN_KEY})


def binding(
    node_id: uuid.UUID,
    field_key: str,
    *,
    source_kind: str = "static",
    payload: dict[str, Any] | None = None,
) -> BindingDraft:
    """造一条绑定的校验形态；`static` 默认已给出值。

    Args: node_id, field_key, source_kind, payload（来源特有的那一件）。
    """
    given = payload or {}
    return BindingDraft(
        node_id=node_id,
        field_key=field_key,
        source_kind=source_kind,
        field_path="",
        node_key=given.get("node_key"),
        compute_json=given.get("compute_json"),
        detail_json=given.get("detail_json"),
        static_value_json=1 if source_kind == "static" else None,
        has_static_value=source_kind == "static",
    )


def codes(issues: list[Any]) -> list[str]:
    """取问题的错误码。

    Args: issues。
    """
    return sorted(item.code for item in issues)


def test_a_declared_scalar_slot_passes() -> None:
    node_id = uuid7()
    issues = check_field_keys(
        [binding(node_id, "sceneStatus")],
        module_types={node_id: "probe-view"},
        catalog=CATALOG,
    )
    assert issues == []


def test_a_slot_the_module_never_declared_is_rejected() -> None:
    node_id = uuid7()
    issues = check_field_keys(
        [binding(node_id, "title")],
        module_types={node_id: "probe-view"},
        catalog=CATALOG,
    )
    assert codes(list(issues)) == ["field_key_unknown"]


def test_a_module_without_slots_rejects_every_binding() -> None:
    node_id = uuid7()
    issues = check_field_keys(
        [binding(node_id, "sceneStatus")],
        module_types={node_id: "probe-block"},
        catalog=CATALOG,
    )
    assert codes(list(issues)) == ["field_key_unknown"]


def test_array_slots_accept_declared_sub_keys() -> None:
    node_id = uuid7()
    issues = check_field_keys(
        [
            binding(node_id, "hotspots[0].value"),
            binding(node_id, "hotspots[0].state"),
            binding(node_id, "hotspots[1].value"),
        ],
        module_types={node_id: "probe-view"},
        catalog=CATALOG,
    )
    assert issues == []


def test_an_array_sub_key_outside_the_manifest_is_rejected() -> None:
    node_id = uuid7()
    issues = check_field_keys(
        [binding(node_id, "hotspots[0].pressure")],
        module_types={node_id: "probe-view"},
        catalog=CATALOG,
    )
    assert codes(list(issues)) == ["field_key_unknown"]


def test_an_array_index_that_skips_zero_is_rejected() -> None:
    node_id = uuid7()
    issues = check_field_keys(
        [binding(node_id, "hotspots[7].value")],
        module_types={node_id: "probe-view"},
        catalog=CATALOG,
    )
    assert codes(list(issues)) == ["array_index_gap"]


def test_a_gap_inside_an_array_run_is_rejected() -> None:
    node_id = uuid7()
    issues = check_field_keys(
        [
            binding(node_id, "hotspots[0].value"),
            binding(node_id, "hotspots[2].value"),
        ],
        module_types={node_id: "probe-view"},
        catalog=CATALOG,
    )
    assert codes(list(issues)) == ["array_index_gap"]


def test_binding_one_slot_twice_conflicts() -> None:
    node_id = uuid7()
    issues = check_field_keys(
        [binding(node_id, "sceneStatus"), binding(node_id, "sceneStatus")],
        module_types={node_id: "probe-view"},
        catalog=CATALOG,
    )
    assert codes(list(issues)) == ["field_key_taken"]


def test_a_field_key_that_does_not_parse_is_rejected() -> None:
    node_id = uuid7()
    issues = check_field_keys(
        [binding(node_id, "hotspots.value")],
        module_types={node_id: "probe-view"},
        catalog=CATALOG,
    )
    assert codes(list(issues)) == ["field_key_unknown"]


def test_bindings_on_an_unknown_node_are_left_to_the_node_rules() -> None:
    issues = check_field_keys(
        [binding(uuid7(), "sceneStatus")],
        module_types={},
        catalog=CATALOG,
    )
    assert issues == []


def test_a_misspelled_source_kind_is_rejected() -> None:
    issues = check_sources(
        [binding(uuid7(), "sceneStatus", source_kind="opuca")],
        known_node_keys=KNOWN,
    )
    assert codes(list(issues)) == ["source_kind_unknown"]


def test_a_realtime_binding_without_a_point_is_rejected() -> None:
    issues = check_sources(
        [binding(uuid7(), "sceneStatus", source_kind="opcua")],
        known_node_keys=KNOWN,
    )
    assert codes(list(issues)) == ["source_payload_missing"]


def test_a_realtime_binding_on_a_known_point_passes() -> None:
    issues = check_sources(
        [
            binding(
                uuid7(),
                "sceneStatus",
                source_kind="opcua",
                payload={"node_key": KNOWN_KEY},
            )
        ],
        known_node_keys=KNOWN,
    )
    assert issues == []


def test_a_point_outside_the_catalog_is_rejected() -> None:
    issues = check_sources(
        [
            binding(
                uuid7(),
                "sceneStatus",
                source_kind="opcua",
                payload={"node_key": f"{SOURCE_ID}:missing"},
            )
        ],
        known_node_keys=KNOWN,
    )
    assert codes(list(issues)) == ["point_not_found"]


def test_a_point_identity_without_a_source_uuid_is_rejected() -> None:
    issues = check_sources(
        [
            binding(
                uuid7(),
                "sceneStatus",
                source_kind="opcua",
                payload={"node_key": "outlet_temp"},
            )
        ],
        known_node_keys=KNOWN,
    )
    assert codes(list(issues)) == ["node_key_malformed"]


def test_a_history_binding_reads_its_point_out_of_the_detail() -> None:
    issues = check_sources(
        [
            binding(
                uuid7(),
                "sceneStatus",
                source_kind="archive",
                payload={
                    "detail_json": {
                        "node_key": KNOWN_KEY,
                        "range": {"limit": 10},
                    }
                },
            )
        ],
        known_node_keys=KNOWN,
    )
    assert issues == []


def test_a_history_binding_pointing_nowhere_is_rejected() -> None:
    issues = check_sources(
        [
            binding(
                uuid7(),
                "sceneStatus",
                source_kind="archive",
                payload={"detail_json": {"node_key": f"{SOURCE_ID}:missing"}},
            )
        ],
        known_node_keys=KNOWN,
    )
    assert [(item.field, item.code) for item in issues] == [
        ("detail_json", "point_not_found")
    ]


def test_a_derived_binding_needs_a_registered_operator() -> None:
    issues = check_sources(
        [
            binding(
                uuid7(),
                "sceneStatus",
                source_kind="computed",
                payload={"compute_json": {"op": "median", "inputs": ["a"]}},
            )
        ],
        known_node_keys=KNOWN,
    )
    assert codes(list(issues)) == ["compute_spec_invalid"]


def test_a_derived_binding_needs_non_empty_inputs() -> None:
    issues = check_sources(
        [
            binding(
                uuid7(),
                "sceneStatus",
                source_kind="computed",
                payload={"compute_json": {"op": "sum", "inputs": []}},
            )
        ],
        known_node_keys=KNOWN,
    )
    assert codes(list(issues)) == ["compute_spec_invalid"]


def test_a_well_formed_derived_binding_passes() -> None:
    issues = check_sources(
        [
            binding(
                uuid7(),
                "sceneStatus",
                source_kind="computed",
                payload={"compute_json": {"op": "sum", "inputs": ["a", "b"]}},
            )
        ],
        known_node_keys=KNOWN,
    )
    assert issues == []


def test_only_point_backed_sources_are_looked_up() -> None:
    node_id = uuid7()
    keys = referenced_node_keys(
        [
            binding(node_id, "sceneStatus"),
            binding(
                node_id,
                "hotspots[0].value",
                source_kind="opcua",
                payload={"node_key": KNOWN_KEY},
            ),
        ]
    )
    assert keys == frozenset({KNOWN_KEY})


def test_an_entity_pinned_slot_may_skip_rows() -> None:
    # ⚠ 行钉在实体上时，「只绑第 4 个锚点」是正常配法：行数由配置里的实体数
    # 决定，空出来的那几行只表示那些实体没接数据源。套连续性会让这条存不下去，
    # 而错误文案说的是索引不连续，与用户做的事对不上号
    node_id = uuid7()
    issues = check_field_keys(
        [binding(node_id, "anchorValues[3].value")],
        module_types={node_id: "probe-scene"},
        catalog=CATALOG,
    )
    assert issues == []


def test_an_entity_pinned_slot_may_leave_a_hole_in_the_middle() -> None:
    node_id = uuid7()
    issues = check_field_keys(
        [
            binding(node_id, "anchorValues[0].value"),
            binding(node_id, "anchorValues[2].value"),
        ],
        module_types={node_id: "probe-scene"},
        catalog=CATALOG,
    )
    assert issues == []


def test_an_entity_pinned_slot_still_rejects_a_duplicate_row() -> None:
    # 免掉的只有连续性这一条，撞键照拦
    node_id = uuid7()
    issues = check_field_keys(
        [
            binding(node_id, "anchorValues[1].value"),
            binding(node_id, "anchorValues[1].value"),
        ],
        module_types={node_id: "probe-scene"},
        catalog=CATALOG,
    )
    assert codes(list(issues)) == ["field_key_taken"]


def test_an_unknown_module_type_keeps_the_contiguity_check() -> None:
    # ⚠ 认不出模块就按列表式处理：宁可多拦一条，也不要因为清单读不出来
    # 就把这道闸整个放掉
    node_id = uuid7()
    issues = check_field_keys(
        [binding(node_id, "anchorValues[3].value")],
        module_types={node_id: "never-registered"},
        catalog=CATALOG,
    )
    assert "array_index_gap" in codes(list(issues))
