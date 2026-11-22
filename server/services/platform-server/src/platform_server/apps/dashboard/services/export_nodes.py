"""生成导出包的稳定节点键并序列化节点及其绑定。"""

import uuid
from collections.abc import Sequence

from platform_server.apps.dashboard.models import (
    DashboardBinding,
    DashboardNode,
)
from platform_server.apps.dashboard.schemas.transfer import (
    ExportBindingIn,
    ExportNodeIn,
)

# 导出侧补键的前缀
DERIVED_KEY_PREFIX = "node"


def derived_client_keys(
    nodes: Sequence[DashboardNode],
) -> dict[uuid.UUID, str]:
    """按确定顺序补齐节点键并避开已有键。Args: nodes。"""
    taken = {node.client_key for node in nodes if node.client_key is not None}
    keys: dict[uuid.UUID, str] = {}
    for index, node in enumerate(nodes):
        keys[node.id] = node.client_key or _free_key(index, taken)
    return keys


def _free_key(index: int, taken: set[str]) -> str:
    candidate = f"{DERIVED_KEY_PREFIX}-{index}"
    serial = 2
    while candidate in taken:
        candidate = f"{DERIVED_KEY_PREFIX}-{index}.{serial}"
        serial += 1
    taken.add(candidate)
    return candidate


def export_node(
    node: DashboardNode,
    *,
    client_key: str,
    parent_key: str | None,
    bindings: Sequence[DashboardBinding],
) -> ExportNodeIn:
    """一个节点在导出包里的形态。

    Args: node, client_key, parent_key, bindings。
    """
    return ExportNodeIn(
        client_key=client_key,
        parent_key=parent_key,
        module_type=node.module_type,
        x_px=node.x_px,
        y_px=node.y_px,
        width_px=node.width_px,
        height_px=node.height_px,
        z_index=node.z_index,
        is_visible=node.is_visible,
        config_json=node.config_json,
        bindings=[_to_export_binding(item) for item in bindings],
    )


def _to_export_binding(binding: DashboardBinding) -> ExportBindingIn:
    # ⚠ 走 `model_validate` 而不是逐字段构造：库里 `source_kind` 是 Text 加
    # CHECK，取值集合由 source_kinds.py 与 `SourceKind` 同口径守着
    return ExportBindingIn.model_validate(binding, from_attributes=True)
