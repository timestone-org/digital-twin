"""节点树的结构校验：父节点、成环、模块类型、`client_key` 撞键。

⚠ 成环检查做在服务端。参考实现把它写在模型注释里交给前端，那条注释本身
就是这个洞的自述——前端拖不出环，Agent 与直接调接口的人拖得出。
"""

import uuid
from collections.abc import Sequence

from lib.errors import FieldError
from platform_server.apps.dashboard.services.drafts import NodeDraft, at_field
from platform_server.apps.dashboard.services.module_catalog import (
    ModuleCatalog,
)


def check_nodes(
    nodes: Sequence[NodeDraft], *, catalog: ModuleCatalog
) -> list[FieldError]:
    """把一棵**最终形态**的节点树查一遍，返回全部问题。

    Args: nodes, catalog。
    """
    return [
        *_check_module_types(nodes, catalog=catalog),
        *_check_parents(nodes),
        *_check_client_keys(nodes),
    ]


def _check_module_types(
    nodes: Sequence[NodeDraft], *, catalog: ModuleCatalog
) -> list[FieldError]:
    known = catalog.known_types()
    return [
        FieldError(
            field=at_field(node.field_path, "module_type"),
            code="module_type_unknown",
            message=f"模块类型未注册：{node.module_type}",
        )
        for node in nodes
        if node.module_type not in known
    ]


def _check_parents(nodes: Sequence[NodeDraft]) -> list[FieldError]:
    known = {node.node_id for node in nodes}
    found: list[FieldError] = []
    for node in nodes:
        if node.parent_id is None:
            continue
        if node.parent_id == node.node_id:
            found.append(
                _parent_error(node, "parent_is_self", "父节点不能是自己")
            )
        elif node.parent_id not in known:
            found.append(
                _parent_error(node, "parent_not_found", "父节点不存在")
            )
    found.extend(_check_cycles(nodes))
    return found


def _check_cycles(nodes: Sequence[NodeDraft]) -> list[FieldError]:
    """找出全部落在环上的节点。

    ⚠ 只查「父节点存在吗」拦不住成环：A 的父是 B、B 的父是 A，两条引用各自
    都指向真实存在的节点。
    Args: nodes。
    """
    # 自指已经由 `parent_is_self` 报过，别再让它多出一条成环
    parents = {
        node.node_id: (
            None if node.parent_id == node.node_id else node.parent_id
        )
        for node in nodes
    }
    on_cycle = _cycle_members(parents)
    return [
        _parent_error(node, "parent_cycle", "节点树成环")
        for node in nodes
        if node.node_id in on_cycle
    ]


def _cycle_members(
    parents: dict[uuid.UUID, uuid.UUID | None],
) -> set[uuid.UUID]:
    """沿 parent 指针走，落在环上的节点集合。

    Args: parents。
    """
    settled: set[uuid.UUID] = set()
    on_cycle: set[uuid.UUID] = set()
    for start in parents:
        walked: list[uuid.UUID] = []
        seen: set[uuid.UUID] = set()
        current: uuid.UUID | None = start
        while current is not None and current not in settled:
            if current in seen:
                on_cycle.update(walked[walked.index(current) :])
                break
            seen.add(current)
            walked.append(current)
            current = parents.get(current)
        settled.update(walked)
    return on_cycle


def _check_client_keys(nodes: Sequence[NodeDraft]) -> list[FieldError]:
    seen: dict[str, uuid.UUID] = {}
    found: list[FieldError] = []
    for node in nodes:
        key = node.client_key
        if key is None:
            continue
        if key in seen and seen[key] != node.node_id:
            found.append(
                FieldError(
                    field=at_field(node.field_path, "client_key"),
                    code="client_key_taken",
                    message=f"同一张大屏里已有这个 client_key：{key}",
                )
            )
            continue
        seen[key] = node.node_id
    return found


def _parent_error(node: NodeDraft, code: str, message: str) -> FieldError:
    return FieldError(
        field=at_field(node.field_path, "parent_id"),
        code=code,
        message=message,
    )
