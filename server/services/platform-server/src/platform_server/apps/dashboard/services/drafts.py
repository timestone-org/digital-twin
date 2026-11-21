"""校验用的中间形态：把「逐节点写」与「整树替换」两条路径拉成同一个形状。

⚠ 两条路径必须过同一套校验：批量路径走一条更宽松的校验，就等于「先用批量
接口写进去、再用单条接口读出来」这个绕过校验的后门（ADR-0012 三）。
"""

import uuid
from dataclasses import dataclass, field
from typing import Any, cast

from platform_server.apps.dashboard.models import (
    DashboardBinding,
    DashboardNode,
)


@dataclass(frozen=True)
class NodeDraft:
    """一个节点在校验期的形态。`field_path` 决定错误指到请求体的哪一处。"""

    node_id: uuid.UUID
    parent_id: uuid.UUID | None
    client_key: str | None
    module_type: str
    field_path: str


@dataclass(frozen=True)
class BindingDraft:
    """一条绑定在校验期的形态。"""

    node_id: uuid.UUID
    field_key: str
    source_kind: str
    field_path: str
    node_key: str | None = None
    compute_json: dict[str, Any] | None = None
    detail_json: dict[str, Any] | None = None
    static_value_json: Any = None
    has_static_value: bool = field(default=False)
    should_check_compute_details: bool = False


def node_draft_of(node: DashboardNode, *, field_path: str) -> NodeDraft:
    """把已落库的节点转成校验形态。

    Args: node, field_path。
    """
    return NodeDraft(
        node_id=node.id,
        parent_id=node.parent_id,
        client_key=node.client_key,
        module_type=node.module_type,
        field_path=field_path,
    )


def binding_draft_of(
    binding: DashboardBinding,
    *,
    field_path: str,
    should_check_compute_details: bool = False,
) -> BindingDraft:
    """把已落库的绑定转成校验形态。

    Args: binding, field_path。
    """
    return BindingDraft(
        node_id=binding.node_id,
        field_key=binding.field_key,
        source_kind=binding.source_kind,
        field_path=field_path,
        node_key=binding.node_key,
        compute_json=binding.compute_json,
        detail_json=binding.detail_json,
        static_value_json=binding.static_value_json,
        has_static_value=binding.static_value_json is not None,
        should_check_compute_details=should_check_compute_details,
    )


def same_compute_payload(before: object, after: object) -> bool:
    """比较 JSON 值，保留布尔值和数字的类型区别。"""
    if isinstance(before, bool) or isinstance(after, bool):
        return before is after
    if isinstance(before, dict) and isinstance(after, dict):
        old_members = cast("dict[str, object]", before)
        new_members = cast("dict[str, object]", after)
        return old_members.keys() == new_members.keys() and all(
            same_compute_payload(old_members[key], new_members[key])
            for key in old_members
        )
    if isinstance(before, list) and isinstance(after, list):
        old_items = cast("list[object]", before)
        new_items = cast("list[object]", after)
        return len(old_items) == len(new_items) and all(
            same_compute_payload(left, right)
            for left, right in zip(old_items, new_items, strict=True)
        )
    return before == after


def at_field(field_path: str, name: str) -> str:
    """拼出错误指向的字段路径。顶层路径为空时就是字段名本身。

    Args: field_path, name。
    """
    return f"{field_path}.{name}" if field_path else name
