"""导出包的形状：不带任何 id，且导出的包能原样导回。

⚠ 出参还必须经得起「dump 进幂等缓存再 validate 回来」这一趟——过不去的话，
带 `Idempotency-Key` 的复制与导入一重放就是 500。
"""

import uuid
from datetime import UTC, datetime

import pytest
from pydantic import BaseModel, ValidationError

from platform_server.apps.dashboard.schemas import NodeOut
from platform_server.apps.dashboard.schemas.module_type import (
    BindingSpecOut,
    ModuleDefaultSizeOut,
    ModuleTypeOut,
)
from platform_server.apps.dashboard.schemas.transfer import (
    COPY_NAME_SUFFIX,
    DashboardExportIn,
    DashboardExportOptionsIn,
    DashboardExportOut,
    DashboardImportIn,
    DashboardImportOut,
    DuplicateDashboardIn,
    ExportBindingIn,
    ExportNodeIn,
    UnresolvedBindingOut,
)
from platform_server.apps.dashboard.services.module_catalog import ModuleCatalog
from platform_server.apps.dashboard.services.transfer_bindings import (
    without_point_bindings,
)
from platform_server.apps.dashboard.services.transfer_service import (
    MAX_NAME_LENGTH,
    copy_name,
    point_key_of,
)

KNOWN_KEY = "0192f0c0-0000-7000-8000-00000000abcd:outlet_temp"


def id_named_fields(model: type[BaseModel], prefix: str = "") -> list[str]:
    """模型树里全部名字带 id 的字段路径。

    Args: model, prefix。
    """
    found: list[str] = []
    for name, field in model.model_fields.items():
        path = f"{prefix}{name}"
        if name == "id" or name.endswith("_id"):
            found.append(path)
        found.extend(_nested(field.annotation, f"{path}."))
    return found


def _nested(annotation: object, prefix: str) -> list[str]:
    found: list[str] = []
    for candidate in (annotation, *getattr(annotation, "__args__", ())):
        if isinstance(candidate, type) and issubclass(candidate, BaseModel):
            found.extend(id_named_fields(candidate, prefix))
    return found


def sample_node() -> ExportNodeIn:
    """一个带绑定的包内节点。"""
    return ExportNodeIn(
        client_key="header-1",
        parent_key=None,
        module_type="twin-view",
        x_px=10,
        y_px=20,
        width_px=300,
        height_px=200,
        z_index=3,
        is_visible=False,
        config_json={"title": "主屏"},
        bindings=[
            ExportBindingIn(
                field_key="anchorValues[0].value",
                source_kind="opcua",
                node_key=KNOWN_KEY,
            )
        ],
    )


def sample_package() -> DashboardExportOut:
    """一份带一个节点的导出包。"""
    return DashboardExportOut(
        schema_version=2,
        name="主屏",
        description="说明",
        design_width=1920,
        design_height=1080,
        theme_json={"mode": "dark"},
        chrome_json={"is_grid_shown": True},
        nodes=[sample_node()],
    )


def sample_node_out() -> NodeOut:
    """一个对外形态的节点，用来过幂等缓存那一趟。"""
    moment = datetime(2026, 8, 14, 9, 30, tzinfo=UTC)
    return NodeOut(
        id=uuid.uuid4(),
        dashboard_id=uuid.uuid4(),
        parent_id=None,
        client_key="header-1",
        module_type="header",
        x_px=1,
        y_px=2,
        width_px=3,
        height_px=4,
        z_index=0,
        is_visible=True,
        config_json={},
        created_at=moment,
        updated_at=moment,
        bindings=[],
    )


def test_no_field_in_the_export_package_carries_an_id() -> None:
    # 带 id 的包导回同一个库，会让「导入」变成悄悄改掉源屏
    assert id_named_fields(DashboardExportOut) == []


def test_the_package_expresses_parents_with_a_client_key() -> None:
    assert "parent_key" in ExportNodeIn.model_fields


def test_geometry_travels_under_the_short_names() -> None:
    dumped = sample_package().model_dump(mode="json", by_alias=True)
    assert set(dumped["nodes"][0]) >= {"x", "y", "w", "h"}


def test_an_exported_package_validates_back_as_an_import_payload() -> None:
    dumped = sample_package().model_dump(mode="json", by_alias=True)
    assert DashboardExportIn.model_validate(dumped).nodes[0].x_px == 10


def test_a_package_keeps_its_bindings_across_the_round_trip() -> None:
    dumped = sample_package().model_dump(mode="json", by_alias=True)
    restored = DashboardExportIn.model_validate(dumped)
    assert restored.nodes[0].bindings[0].node_key == KNOWN_KEY


def test_an_import_result_survives_the_idempotency_cache_round_trip() -> None:
    # 幂等重放走的是「dump 进缓存 → validate 取回」，过不去就是 500
    result = DashboardImportOut(
        id=uuid.uuid4(),
        project_id=uuid.uuid4(),
        name="主屏",
        description=None,
        design_width=1920,
        design_height=1080,
        row_version=1,
        schema_version=1,
        is_public=False,
        node_count=1,
        created_at=datetime(2026, 8, 14, 9, 30, tzinfo=UTC),
        updated_at=datetime(2026, 8, 14, 9, 30, tzinfo=UTC),
        theme_json={},
        chrome_json={},
        nodes=[sample_node_out()],
        unresolved_bindings=[],
    )
    dumped = result.model_dump(mode="json", by_alias=True)
    assert DashboardImportOut.model_validate(dumped).node_count == 1


def test_an_unresolved_binding_names_the_point_it_could_not_find() -> None:
    entry = UnresolvedBindingOut(
        node_key=KNOWN_KEY,
        field_key="anchorValues[0].value",
        source_kind="opcua",
        reason="point_not_found",
    )
    assert entry.node_key == KNOWN_KEY


def test_a_realtime_binding_reports_the_point_it_points_at() -> None:
    entry = ExportBindingIn(
        field_key="anchorValues[0].value",
        source_kind="opcua",
        node_key=KNOWN_KEY,
    )
    assert point_key_of(entry) == KNOWN_KEY


def test_a_history_binding_reports_the_point_hidden_in_its_detail() -> None:
    # 历史绑定的点位写在取数说明里，只看 node_key 会把它报成「没指点位」
    entry = ExportBindingIn(
        field_key="anchorValues[0].value",
        source_kind="archive",
        detail_json={"node_key": KNOWN_KEY},
    )
    assert point_key_of(entry) == KNOWN_KEY


def test_a_constant_binding_points_at_no_point_at_all() -> None:
    entry = ExportBindingIn(
        field_key="anchorValues[0].value",
        source_kind="static",
        static_value_json=1,
    )
    assert point_key_of(entry) == ""


def test_a_copy_takes_the_source_name_plus_the_suffix() -> None:
    assert copy_name("主屏") == f"主屏{COPY_NAME_SUFFIX}"


def test_a_copy_of_a_maximum_length_name_still_fits_the_limit() -> None:
    # 必须先截断再拼后缀：拼出来超限那一下抛在出参构造处，对外是 500 不是 400
    assert len(copy_name("屏" * MAX_NAME_LENGTH)) == MAX_NAME_LENGTH


def transfer_catalog(*, is_pinned: bool = False) -> ModuleCatalog:
    """声明一个有数组槽的模块；参数 is_pinned 决定是否按实体固定索引。"""
    return ModuleCatalog(
        catalog_version=1,
        modules=(
            ModuleTypeOut(
                type="twin-view",
                display_name="试验件",
                category="试验",
                default_size=ModuleDefaultSizeOut(width=100, height=100),
                bindings=[
                    BindingSpecOut(
                        key="anchorValues",
                        label="读数",
                        data_type="number",
                        is_array=True,
                        is_entity_pinned=is_pinned,
                        array_fields=[
                            BindingSpecOut(
                                key="value", label="数值", data_type="number"
                            ),
                        ],
                    ),
                ],
            ),
        ),
    )


def computed_binding(field_key: str, *inputs: str) -> ExportBindingIn:
    """创建派生绑定；参数 field_key 与 inputs 都是同一节点的槽键。"""
    return ExportBindingIn(
        field_key=field_key,
        source_kind="computed",
        compute_json={"op": "sum", "inputs": list(inputs)},
    )


def mixed_point_node() -> ExportNodeIn:
    """混合点位、静态值、台账与多层计算的节点。"""
    node = sample_node()
    node.bindings = [
        computed_binding("derivedAgain", "derived"),
        computed_binding("derived", "anchorValues[0].value"),
        ExportBindingIn(
            field_key="anchorValues[0].value",
            source_kind="opcua",
            node_key=KNOWN_KEY,
        ),
        ExportBindingIn(
            field_key="history",
            source_kind="archive",
            detail_json={"node_key": KNOWN_KEY},
        ),
        computed_binding("historySum", "history"),
        ExportBindingIn(
            field_key="constant", source_kind="static", static_value_json=42
        ),
        ExportBindingIn(
            field_key="datasetValue",
            source_kind="dataset",
            detail_json={"column_ref": "ds:energy:power"},
        ),
        computed_binding("constantSum", "constant"),
    ]
    return node


def test_ignoring_points_preserves_only_independent_bindings() -> None:
    result = without_point_bindings(
        [mixed_point_node()], catalog=transfer_catalog()
    )
    assert [binding.field_key for binding in result[0].bindings] == [
        "constant",
        "datasetValue",
        "constantSum",
    ]


def test_ignoring_points_does_not_change_the_source_document() -> None:
    node = mixed_point_node()
    before = node.model_dump(mode="json", by_alias=True)
    result = without_point_bindings([node], catalog=transfer_catalog())
    assert node.model_dump(mode="json", by_alias=True) == before
    assert result[0].model_dump(exclude={"bindings"}) == node.model_dump(
        exclude={"bindings"}
    )


def test_computation_dependencies_are_local_to_each_node() -> None:
    point_node = mixed_point_node()
    other_node = sample_node()
    other_node.client_key = "other"
    other_node.bindings = [
        ExportBindingIn(
            field_key="anchorValues[0].value",
            source_kind="static",
            static_value_json=1,
        ),
        computed_binding("derived", "anchorValues[0].value"),
    ]
    result = without_point_bindings(
        [point_node, other_node], catalog=transfer_catalog(is_pinned=True)
    )
    assert result[1] == other_node


def test_entity_pinned_slots_keep_their_original_indexes() -> None:
    node = sample_node()
    node.bindings.extend(
        [
            ExportBindingIn(
                field_key="anchorValues[7].value",
                source_kind="static",
                static_value_json=4,
            ),
            computed_binding("derived", "anchorValues[7].value"),
        ]
    )
    result = without_point_bindings(
        [node], catalog=transfer_catalog(is_pinned=True)
    )
    assert [binding.field_key for binding in result[0].bindings] == [
        "anchorValues[7].value",
        "derived",
    ]
    assert result[0].bindings[1].compute_json == {
        "op": "sum",
        "inputs": ["anchorValues[7].value"],
    }


def test_list_slots_close_gaps_and_rewrite_computation_inputs() -> None:
    node = sample_node()
    node.bindings.extend(
        [
            ExportBindingIn(
                field_key="anchorValues[1].value",
                source_kind="static",
                static_value_json=4,
            ),
            computed_binding("anchorValues[2].value", "anchorValues[1].value"),
            computed_binding("derived", "anchorValues[2].value"),
        ]
    )
    result = without_point_bindings([node], catalog=transfer_catalog())
    assert [binding.field_key for binding in result[0].bindings] == [
        "anchorValues[0].value",
        "anchorValues[1].value",
        "derived",
    ]
    assert [binding.compute_json for binding in result[0].bindings[1:]] == [
        {"op": "sum", "inputs": ["anchorValues[0].value"]},
        {"op": "sum", "inputs": ["anchorValues[1].value"]},
    ]


def test_ignoring_points_handles_an_empty_document() -> None:
    assert without_point_bindings([], catalog=transfer_catalog()) == []


@pytest.mark.parametrize(
    "should_include", [True, False], ids=["keep", "ignore"]
)
def test_transfer_operations_accept_an_explicit_point_binding_choice(
    should_include: bool,
) -> None:
    exported = DashboardExportOptionsIn.model_validate(
        {"include_point_bindings": should_include}
    )
    copied = DuplicateDashboardIn.model_validate(
        {"include_point_bindings": should_include}
    )
    imported = DashboardImportIn.model_validate(
        {
            "project_id": "0192f0c0-0000-7000-8000-00000000abcd",
            "payload": sample_package().model_dump(mode="json", by_alias=True),
            "include_point_bindings": should_include,
        }
    )
    assert copied.should_include_point_bindings is should_include
    assert imported.should_include_point_bindings is should_include
    assert exported.should_include_point_bindings is should_include


def test_legacy_import_and_duplicate_keep_point_bindings_by_default() -> None:
    assert DashboardExportOptionsIn().should_include_point_bindings is True
    copied = DuplicateDashboardIn()
    imported = DashboardImportIn.model_validate(
        {
            "project_id": "0192f0c0-0000-7000-8000-00000000abcd",
            "payload": sample_package().model_dump(mode="json", by_alias=True),
        }
    )
    assert copied.should_include_point_bindings is True
    assert imported.should_include_point_bindings is True


@pytest.mark.parametrize("invalid", [None, "ignored", {}, []])
def test_export_rejects_invalid_point_binding_choices(invalid: object) -> None:
    with pytest.raises(ValidationError):
        DashboardExportOptionsIn.model_validate(
            {"include_point_bindings": invalid}
        )
