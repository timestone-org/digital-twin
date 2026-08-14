"""整树替换的计划：给了 id 就用它，没给才发新的；同一次里 id 不许重复。

⚠ 新节点必须排在父节点之后插入，否则自引用外键在插入那一刻就不成立。
"""

import uuid

import pytest

from lib.utils.ids import uuid7
from platform_server.apps.dashboard.errors import LayoutInvalid
from platform_server.apps.dashboard.schemas import (
    BindingCreateIn,
    LayoutNodeIn,
    ReplaceLayoutIn,
)
from platform_server.apps.dashboard.services.layout_plan import (
    build_plan,
    in_parent_first_order,
)


def entry(
    *,
    node_id: uuid.UUID | None = None,
    parent_id: uuid.UUID | None = None,
    bindings: list[BindingCreateIn] | None = None,
) -> LayoutNodeIn:
    """造一个替换条目。

    Args: node_id, parent_id, bindings。
    """
    return LayoutNodeIn(
        id=node_id,
        parent_id=parent_id,
        module_type="header",
        x_px=0,
        y_px=0,
        width_px=100,
        height_px=50,
        bindings=bindings or [],
    )


def payload(nodes: list[LayoutNodeIn]) -> ReplaceLayoutIn:
    """造一次替换请求。

    Args: nodes。
    """
    return ReplaceLayoutIn(expected_version=1, nodes=nodes)


def test_a_supplied_node_id_survives_planning() -> None:
    node_id = uuid7()
    plan = build_plan(payload([entry(node_id=node_id)]))
    assert plan.node_ids() == {node_id}


def test_a_node_without_an_id_gets_one() -> None:
    plan = build_plan(payload([entry()]))
    assert len(plan.node_ids()) == 1


def test_a_supplied_binding_id_survives_planning() -> None:
    binding_id = uuid7()
    plan = build_plan(
        payload(
            [
                entry(
                    bindings=[
                        BindingCreateIn(
                            id=binding_id,
                            field_key="title",
                            source_kind="static",
                            static_value_json="x",
                        )
                    ]
                )
            ]
        )
    )
    assert plan.binding_ids() == {binding_id}


def test_two_entries_claiming_one_id_are_rejected() -> None:
    node_id = uuid7()
    with pytest.raises(LayoutInvalid) as failure:
        build_plan(payload([entry(node_id=node_id), entry(node_id=node_id)]))
    assert [item.code for item in failure.value.details] == ["duplicate_id"]


def test_the_duplicate_id_error_points_at_the_second_entry() -> None:
    node_id = uuid7()
    with pytest.raises(LayoutInvalid) as failure:
        build_plan(payload([entry(node_id=node_id), entry(node_id=node_id)]))
    assert [item.field for item in failure.value.details] == ["nodes[1].id"]


def test_drafts_carry_the_index_of_the_entry_they_came_from() -> None:
    plan = build_plan(payload([entry(), entry()]))
    assert [draft.field_path for draft in plan.node_drafts()] == [
        "nodes[0]",
        "nodes[1]",
    ]


def test_binding_drafts_carry_the_nested_path() -> None:
    plan = build_plan(
        payload(
            [
                entry(
                    bindings=[
                        BindingCreateIn(
                            field_key="title",
                            source_kind="static",
                            static_value_json="x",
                        )
                    ]
                )
            ]
        )
    )
    assert [draft.field_path for draft in plan.binding_drafts()] == [
        "nodes[0].bindings[0]"
    ]


def test_children_are_ordered_after_their_parents() -> None:
    parent_id = uuid7()
    child_id = uuid7()
    plan = build_plan(
        payload(
            [
                entry(node_id=child_id, parent_id=parent_id),
                entry(node_id=parent_id),
            ]
        )
    )
    ordered = [node.node_id for node in in_parent_first_order(plan.nodes)]
    assert ordered == [parent_id, child_id]


def test_nodes_that_cannot_be_ordered_are_still_all_returned() -> None:
    # 成环由校验拦在前面，但排序本身不许静默丢节点
    first = uuid7()
    second = uuid7()
    plan = build_plan(
        payload(
            [
                entry(node_id=first, parent_id=second),
                entry(node_id=second, parent_id=first),
            ]
        )
    )
    ordered = {node.node_id for node in in_parent_first_order(plan.nodes)}
    assert ordered == {first, second}


def test_a_node_whose_parent_lives_outside_the_batch_keeps_its_place() -> None:
    outside = uuid7()
    node_id = uuid7()
    plan = build_plan(payload([entry(node_id=node_id, parent_id=outside)]))
    ordered = [node.node_id for node in in_parent_first_order(plan.nodes)]
    assert ordered == [node_id]
