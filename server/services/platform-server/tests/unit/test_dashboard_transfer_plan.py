"""导入计划：`client_key` 是包里的唯一身份，父子引用只认它。

⚠ 包里没有 id，故 `client_key` 撞了或者父引用指到包外时，只能整包拒收——
猜一个落点等于悄悄改掉这张屏的结构。
"""

import uuid

import pytest

from platform_server.apps.dashboard.errors import ExportPayloadInvalid
from platform_server.apps.dashboard.models import DashboardNode
from platform_server.apps.dashboard.schemas.transfer import (
    DashboardExportIn,
    ExportBindingIn,
    ExportNodeIn,
)
from platform_server.apps.dashboard.services.transfer_service import (
    binding_drafts,
    derived_client_keys,
    in_parent_first_order,
    node_drafts,
    plan_import,
)


def node_entry(
    *,
    client_key: str,
    parent_key: str | None = None,
    module_type: str = "header",
    bindings: list[ExportBindingIn] | None = None,
) -> ExportNodeIn:
    """造一个包里的节点条目。

    Args: client_key, parent_key, module_type, bindings。
    """
    return ExportNodeIn(
        client_key=client_key,
        parent_key=parent_key,
        module_type=module_type,
        x_px=0,
        y_px=0,
        width_px=100,
        height_px=50,
        bindings=bindings or [],
    )


def package(nodes: list[ExportNodeIn]) -> DashboardExportIn:
    """造一份最小的导入包。

    Args: nodes。
    """
    return DashboardExportIn(
        schema_version=1,
        name="主屏",
        description=None,
        design_width=1920,
        design_height=1080,
        nodes=nodes,
    )


def stored_node(
    *, client_key: str | None, node_id: uuid.UUID | None = None
) -> DashboardNode:
    """造一个已落库形态的节点，只填导出要用到的列。

    Args: client_key, node_id。
    """
    return DashboardNode(
        id=node_id or uuid.uuid4(),
        dashboard_id=uuid.uuid4(),
        parent_id=None,
        client_key=client_key,
        module_type="header",
        x_px=0,
        y_px=0,
        width_px=100,
        height_px=50,
        z_index=0,
        is_visible=True,
        config_json={},
    )


def test_every_node_in_the_package_gets_its_own_id() -> None:
    planned = plan_import(
        package([node_entry(client_key="a"), node_entry(client_key="b")])
    )
    assert len({item.node_id for item in planned}) == 2


def test_a_parent_key_becomes_the_parent_id_of_the_named_node() -> None:
    planned = plan_import(
        package(
            [
                node_entry(client_key="child", parent_key="root"),
                node_entry(client_key="root"),
            ]
        )
    )
    by_key = {item.entry.client_key: item for item in planned}
    assert by_key["child"].parent_id == by_key["root"].node_id


def test_a_node_without_a_parent_key_stays_at_the_top() -> None:
    planned = plan_import(package([node_entry(client_key="a")]))
    assert planned[0].parent_id is None


def test_two_nodes_claiming_one_client_key_are_refused() -> None:
    with pytest.raises(ExportPayloadInvalid) as failure:
        plan_import(
            package([node_entry(client_key="a"), node_entry(client_key="a")])
        )
    assert [item.field for item in failure.value.details] == [
        "nodes[1].client_key"
    ]


def test_a_parent_key_outside_the_package_is_refused() -> None:
    with pytest.raises(ExportPayloadInvalid) as failure:
        plan_import(package([node_entry(client_key="a", parent_key="nowhere")]))
    assert [item.code for item in failure.value.details] == [
        "parent_key_not_found"
    ]


def test_drafts_point_at_the_entry_they_came_from() -> None:
    planned = plan_import(
        package([node_entry(client_key="a"), node_entry(client_key="b")])
    )
    assert [draft.field_path for draft in node_drafts(planned)] == [
        "nodes[0]",
        "nodes[1]",
    ]


def test_binding_drafts_carry_the_nested_path() -> None:
    planned = plan_import(
        package(
            [
                node_entry(
                    client_key="a",
                    module_type="twin-view",
                    bindings=[
                        ExportBindingIn(
                            field_key="scene_status",
                            source_kind="static",
                            static_value_json="on",
                        )
                    ],
                )
            ]
        )
    )
    assert [draft.field_path for draft in binding_drafts(planned)] == [
        "nodes[0].bindings[0]"
    ]


def test_a_binding_draft_reports_the_node_it_hangs_on() -> None:
    planned = plan_import(
        package(
            [
                node_entry(
                    client_key="a",
                    module_type="twin-view",
                    bindings=[
                        ExportBindingIn(
                            field_key="scene_status",
                            source_kind="static",
                            static_value_json="on",
                        )
                    ],
                )
            ]
        )
    )
    assert binding_drafts(planned)[0].node_id == planned[0].node_id


def test_children_are_ordered_after_their_parents() -> None:
    planned = plan_import(
        package(
            [
                node_entry(client_key="child", parent_key="root"),
                node_entry(client_key="root"),
            ]
        )
    )
    ordered = [item.entry.client_key for item in in_parent_first_order(planned)]
    assert ordered == ["root", "child"]


def test_nodes_that_cannot_be_ordered_are_still_all_returned() -> None:
    # 成环由校验拦在前面，但排序本身不许静默丢节点
    planned = plan_import(
        package(
            [
                node_entry(client_key="first", parent_key="second"),
                node_entry(client_key="second", parent_key="first"),
            ]
        )
    )
    ordered = {item.entry.client_key for item in in_parent_first_order(planned)}
    assert ordered == {"first", "second"}


def test_a_node_that_already_has_a_client_key_keeps_it() -> None:
    node = stored_node(client_key="header-1")
    assert derived_client_keys([node]) == {node.id: "header-1"}


def test_a_node_without_a_client_key_gets_one_derived_from_its_place() -> None:
    first = stored_node(client_key=None)
    second = stored_node(client_key=None)
    assert list(derived_client_keys([first, second]).values()) == [
        "node-0",
        "node-1",
    ]


def test_deriving_twice_over_the_same_tree_gives_the_same_keys() -> None:
    nodes = [stored_node(client_key=None), stored_node(client_key="kept")]
    assert derived_client_keys(nodes) == derived_client_keys(nodes)


def test_a_derived_key_never_collides_with_one_the_tree_already_has() -> None:
    # 撞上就等于两个节点共用一个身份，父子引用会指到其中随便一个
    taken = stored_node(client_key="node-1")
    blank = stored_node(client_key=None)
    keys = derived_client_keys([taken, blank])
    assert keys[blank.id] != keys[taken.id]
