"""整树替换的计划：给每个节点与绑定定下 id，并装成校验形态。

⚠ id 一经创建永不改变，替换按 id 做三路比对（新增 / 更新 / 删除），不再
「删光重插」——重生成会让实时推送的 `binding_id` 关联键每次保存断一次，
Agent 上一步建的绑定下一步也就不可寻址了（ADR-0012 二）。
"""

import uuid
from dataclasses import dataclass
from typing import Any

from lib.errors import FieldError
from lib.utils.ids import uuid7
from platform_server.apps.dashboard.errors import LayoutInvalid
from platform_server.apps.dashboard.schemas import (
    BindingCreateIn,
    LayoutNodeIn,
    ReplaceLayoutIn,
)
from platform_server.apps.dashboard.services.drafts import (
    BindingDraft,
    NodeDraft,
)


@dataclass(frozen=True)
class PlannedBinding:
    """替换计划里的一条绑定。"""

    binding_id: uuid.UUID
    node_id: uuid.UUID
    entry: BindingCreateIn
    field_path: str


@dataclass(frozen=True)
class PlannedNode:
    """替换计划里的一个节点。"""

    node_id: uuid.UUID
    entry: LayoutNodeIn
    field_path: str
    bindings: list[PlannedBinding]


@dataclass(frozen=True)
class LayoutPlan:
    """一次整树替换的全部目标状态。"""

    nodes: list[PlannedNode]

    def node_ids(self) -> set[uuid.UUID]:
        """计划里全部节点 id。"""
        return {node.node_id for node in self.nodes}

    def binding_ids(self) -> set[uuid.UUID]:
        """计划里全部绑定 id。"""
        return {
            binding.binding_id
            for node in self.nodes
            for binding in node.bindings
        }

    def node_drafts(self) -> list[NodeDraft]:
        """节点的校验形态。"""
        return [
            NodeDraft(
                node_id=node.node_id,
                parent_id=node.entry.parent_id,
                client_key=node.entry.client_key,
                module_type=node.entry.module_type,
                field_path=node.field_path,
            )
            for node in self.nodes
        ]

    def binding_drafts(self) -> list[BindingDraft]:
        """绑定的校验形态。"""
        return [
            BindingDraft(
                node_id=binding.node_id,
                field_key=binding.entry.field_key,
                source_kind=binding.entry.source_kind,
                field_path=binding.field_path,
                node_key=binding.entry.node_key,
                compute_json=binding.entry.compute_json,
                detail_json=binding.entry.detail_json,
                static_value_json=binding.entry.static_value_json,
                has_static_value=binding.entry.static_value_json is not None,
            )
            for node in self.nodes
            for binding in node.bindings
        ]


def build_plan(payload: ReplaceLayoutIn) -> LayoutPlan:
    """给每个条目定 id：给了就用它，没给就发一个新的 UUIDv7。

    Args: payload。
    """
    nodes: list[PlannedNode] = []
    duplicates: list[FieldError] = []
    seen: set[uuid.UUID] = set()
    for index, entry in enumerate(payload.nodes):
        path = f"nodes[{index}]"
        node_id = entry.id or uuid7()
        duplicates.extend(_claim(seen, node_id, f"{path}.id", "节点"))
        nodes.append(
            PlannedNode(
                node_id=node_id,
                entry=entry,
                field_path=path,
                bindings=_plan_bindings(entry, node_id, path, seen, duplicates),
            )
        )
    if duplicates:
        raise LayoutInvalid(
            "同一次替换里出现了重复的 id", details=tuple(duplicates)
        )
    return LayoutPlan(nodes=nodes)


def _plan_bindings(
    entry: LayoutNodeIn,
    node_id: uuid.UUID,
    path: str,
    seen: set[uuid.UUID],
    duplicates: list[FieldError],
) -> list[PlannedBinding]:
    planned: list[PlannedBinding] = []
    for index, item in enumerate(entry.bindings):
        binding_path = f"{path}.bindings[{index}]"
        binding_id = item.id or uuid7()
        duplicates.extend(
            _claim(seen, binding_id, f"{binding_path}.id", "绑定")
        )
        planned.append(
            PlannedBinding(
                binding_id=binding_id,
                node_id=node_id,
                entry=item,
                field_path=binding_path,
            )
        )
    return planned


def _claim(
    seen: set[uuid.UUID], identity: uuid.UUID, field: str, label: str
) -> list[FieldError]:
    if identity in seen:
        return [
            FieldError(
                field=field,
                code="duplicate_id",
                message=f"这一次替换里已经出现过这个{label} id",
            )
        ]
    seen.add(identity)
    return []


def node_values(entry: LayoutNodeIn) -> dict[str, Any]:
    """一个节点条目里可直接赋值的列。

    Args: entry。
    """
    return {
        "parent_id": entry.parent_id,
        "client_key": entry.client_key,
        "module_type": entry.module_type,
        "x_px": entry.x_px,
        "y_px": entry.y_px,
        "width_px": entry.width_px,
        "height_px": entry.height_px,
        "z_index": entry.z_index,
        "is_visible": entry.is_visible,
        "config_json": entry.config_json,
    }


def binding_values(entry: BindingCreateIn) -> dict[str, Any]:
    """一条绑定条目里可直接赋值的列。

    Args: entry。
    """
    return {
        "field_key": entry.field_key,
        "source_kind": entry.source_kind,
        "node_key": entry.node_key,
        "static_value_json": entry.static_value_json,
        "compute_json": entry.compute_json,
        "detail_json": entry.detail_json,
        "transform_json": entry.transform_json,
    }


def in_parent_first_order(nodes: list[PlannedNode]) -> list[PlannedNode]:
    """按「父在子前」排一遍，新节点才插得进自引用外键。

    ⚠ 计划已经过成环校验，故这里必然排得出来；排不出的残余按原序追加，
    不静默丢节点。
    Args: nodes.
    """
    by_id = {node.node_id: node for node in nodes}
    ordered: list[PlannedNode] = []
    placed: set[uuid.UUID] = set()
    pending = list(nodes)
    while pending:
        ready = [
            node
            for node in pending
            if node.entry.parent_id not in by_id
            or node.entry.parent_id in placed
        ]
        if not ready:
            ordered.extend(pending)
            break
        ordered.extend(ready)
        placed.update(node.node_id for node in ready)
        pending = [node for node in pending if node.node_id not in placed]
    return ordered
