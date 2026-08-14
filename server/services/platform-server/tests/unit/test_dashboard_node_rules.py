"""节点树的结构校验：父节点存在、不自指、不成环、模块类型已注册、键不撞。

⚠ 成环检查必须在服务端做——前端拖不出环，Agent 与直接调接口的人拖得出。
"""

import uuid

from lib.utils.ids import uuid7
from platform_server.apps.dashboard.services.drafts import NodeDraft
from platform_server.apps.dashboard.services.module_catalog import (
    load_module_catalog,
)
from platform_server.apps.dashboard.services.node_rules import check_nodes

CATALOG = load_module_catalog()


def draft(
    node_id: uuid.UUID,
    *,
    parent_id: uuid.UUID | None = None,
    module_type: str = "header",
    client_key: str | None = None,
    field_path: str = "",
) -> NodeDraft:
    """造一个节点的校验形态。

    Args: node_id, parent_id, module_type, client_key, field_path。
    """
    return NodeDraft(
        node_id=node_id,
        parent_id=parent_id,
        client_key=client_key,
        module_type=module_type,
        field_path=field_path,
    )


def codes(issues: list[object]) -> list[str]:
    """取问题的错误码，断言只看这一列。

    Args: issues。
    """
    return sorted(item.code for item in issues)


def test_a_tree_of_registered_modules_has_no_issues() -> None:
    root = uuid7()
    child = uuid7()
    issues = check_nodes(
        [draft(root), draft(child, parent_id=root, module_type="twin-view")],
        catalog=CATALOG,
    )
    assert issues == []


def test_an_unregistered_module_type_is_reported_on_that_field() -> None:
    issues = check_nodes(
        [draft(uuid7(), module_type="gauge-chart", field_path="nodes[2]")],
        catalog=CATALOG,
    )
    assert [(item.field, item.code) for item in issues] == [
        ("nodes[2].module_type", "module_type_unknown")
    ]


def test_a_parent_outside_the_final_node_set_is_rejected() -> None:
    issues = check_nodes([draft(uuid7(), parent_id=uuid7())], catalog=CATALOG)
    assert codes(list(issues)) == ["parent_not_found"]


def test_a_node_pointing_at_itself_is_rejected() -> None:
    node_id = uuid7()
    issues = check_nodes([draft(node_id, parent_id=node_id)], catalog=CATALOG)
    assert "parent_is_self" in codes(list(issues))


def test_a_two_node_cycle_is_reported_on_both_nodes() -> None:
    first = uuid7()
    second = uuid7()
    issues = check_nodes(
        [draft(first, parent_id=second), draft(second, parent_id=first)],
        catalog=CATALOG,
    )
    assert codes(list(issues)) == ["parent_cycle", "parent_cycle"]


def test_a_three_node_cycle_is_reported_while_a_hanging_child_is_not() -> None:
    first = uuid7()
    second = uuid7()
    third = uuid7()
    outside = uuid7()
    issues = check_nodes(
        [
            draft(first, parent_id=third),
            draft(second, parent_id=first),
            draft(third, parent_id=second),
            draft(outside, parent_id=third, field_path="nodes[3]"),
        ],
        catalog=CATALOG,
    )
    on_cycle = {item.field for item in issues if item.code == "parent_cycle"}
    assert on_cycle == {"parent_id"}
    assert len([item for item in issues if item.code == "parent_cycle"]) == 3


def test_two_nodes_claiming_one_client_key_conflict() -> None:
    issues = check_nodes(
        [
            draft(uuid7(), client_key="header-1"),
            draft(uuid7(), client_key="header-1", field_path="nodes[1]"),
        ],
        catalog=CATALOG,
    )
    assert [(item.field, item.code) for item in issues] == [
        ("nodes[1].client_key", "client_key_taken")
    ]


def test_the_same_node_keeping_its_client_key_is_not_a_conflict() -> None:
    node_id = uuid7()
    issues = check_nodes(
        [draft(node_id, client_key="header-1")], catalog=CATALOG
    )
    assert issues == []
