"""导入导出时移除点位绑定，保留无关内容；规则见 docs/DASHBOARD_DESIGN.md。"""

from collections import defaultdict, deque
from collections.abc import Sequence
from dataclasses import dataclass
from typing import cast

from platform_server.apps.dashboard.schemas.transfer import (
    ExportBindingIn,
    ExportNodeIn,
)
from platform_server.apps.dashboard.services.module_catalog import (
    ModuleCatalog,
    parse_field_key,
)


@dataclass(frozen=True)
class ExportOptions:
    """导出时的点位绑定策略与模块目录。"""

    catalog: ModuleCatalog
    should_include_point_bindings: bool = True


def without_point_bindings(
    nodes: Sequence[ExportNodeIn], *, catalog: ModuleCatalog
) -> list[ExportNodeIn]:
    """复制节点并移除点位及依赖点位的绑定。Args: nodes, catalog。"""
    return [_without_node_points(node, catalog=catalog) for node in nodes]


def _without_node_points(
    node: ExportNodeIn, *, catalog: ModuleCatalog
) -> ExportNodeIn:
    copied = node.model_copy(deep=True)
    removed = _dependent_fields(copied.bindings)
    if not removed:
        return copied
    retained = [
        binding
        for binding in copied.bindings
        if binding.field_key not in removed
    ]
    pinned = catalog.slots(copied.module_type).entity_pinned
    indexes = _row_indexes(retained, pinned=pinned)
    for binding in retained:
        binding.field_key = _remap_field(binding.field_key, indexes)
        _remap_inputs(binding, indexes)
    copied.bindings = retained
    return copied


def _compute_inputs(binding: ExportBindingIn) -> list[object]:
    raw: object = (binding.compute_json or {}).get("inputs")
    if not isinstance(raw, list):
        return []
    # ⚠ JSON 数组先收敛为 object，逐项判断后才作槽引用。
    return cast("list[object]", raw)


def _dependent_fields(bindings: Sequence[ExportBindingIn]) -> set[str]:
    dependents: defaultdict[str, list[str]] = defaultdict(list)
    removed = {
        binding.field_key
        for binding in bindings
        if binding.source_kind in {"opcua", "archive"}
    }
    for binding in bindings:
        if binding.source_kind != "computed":
            continue
        for field_key in _compute_inputs(binding):
            if isinstance(field_key, str):
                dependents[field_key].append(binding.field_key)
    pending = deque(removed)
    while pending:
        for dependent in dependents.get(pending.popleft(), ()):
            if dependent not in removed:
                removed.add(dependent)
                pending.append(dependent)
    return removed


def _row_indexes(
    bindings: Sequence[ExportBindingIn], *, pinned: frozenset[str]
) -> dict[tuple[str, int], int]:
    rows: defaultdict[str, set[int]] = defaultdict(set)
    for binding in bindings:
        parsed = parse_field_key(binding.field_key)
        if (
            parsed is not None
            and parsed.array_index is not None
            and parsed.slot not in pinned
        ):
            rows[parsed.slot].add(parsed.array_index)
    return {
        (slot, previous): current
        for slot, indexes in rows.items()
        for current, previous in enumerate(sorted(indexes))
    }


def _remap_field(field_key: str, indexes: dict[tuple[str, int], int]) -> str:
    parsed = parse_field_key(field_key)
    if parsed is None or parsed.array_index is None:
        return field_key
    current = indexes.get((parsed.slot, parsed.array_index))
    if current is None:
        return field_key
    return f"{parsed.slot}[{current}].{parsed.sub_key}"


def _remap_inputs(
    binding: ExportBindingIn, indexes: dict[tuple[str, int], int]
) -> None:
    if binding.source_kind != "computed" or binding.compute_json is None:
        return
    raw: object = binding.compute_json.get("inputs")
    if not isinstance(raw, list):
        return
    binding.compute_json["inputs"] = [
        (
            _remap_field(field_key, indexes)
            if isinstance(field_key, str)
            else field_key
        )
        for field_key in _compute_inputs(binding)
    ]
