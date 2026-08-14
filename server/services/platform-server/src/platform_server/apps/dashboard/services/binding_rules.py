"""绑定的校验：绑定槽、数组索引连续性、来源种类与来源载荷。

⚠ 索引必须连续且从 0 起：参考实现不校验，`rows[7]` 可以在没有 `rows[0..6]`
的情况下存在，于是渲染出一列全空的行（docs/DASHBOARD_DESIGN.md §4.2）。
"""

import uuid
from collections import defaultdict
from collections.abc import Sequence
from typing import cast

from lib.errors import FieldError
from platform_server.apps.dashboard.services.drafts import (
    BindingDraft,
    at_field,
)
from platform_server.apps.dashboard.services.module_catalog import (
    ModuleCatalog,
    ModuleSlots,
    parse_field_key,
)
from platform_server.apps.dashboard.source_kinds import (
    COMPUTE_OPS,
    SOURCE_KINDS,
)
from timeseries import InvalidNodeKey, split_node_key

# 每种来源必须带的那一件东西
_REQUIRED_PAYLOAD = {
    "opcua": ("node_key", "实时绑定必须指向一个点位"),
    "static": ("static_value_json", "常量绑定必须给出值"),
    "computed": ("compute_json", "派生绑定必须给出运算规格"),
    "archive": ("detail_json", "历史绑定必须给出取数说明"),
}


def check_field_keys(
    bindings: Sequence[BindingDraft],
    *,
    module_types: dict[uuid.UUID, str],
    catalog: ModuleCatalog,
) -> list[FieldError]:
    """绑定槽必须是所属模块声明过的槽，数组索引必须连续且从 0 起。

    Args: bindings, module_types, catalog。
    """
    return [
        *_check_slots(bindings, module_types=module_types, catalog=catalog),
        *_check_duplicates(bindings),
        *_check_array_runs(bindings),
    ]


def check_sources(
    bindings: Sequence[BindingDraft], *, known_node_keys: frozenset[str]
) -> list[FieldError]:
    """来源种类必须已注册，载荷必须齐备，点位必须存在。

    Args: bindings, known_node_keys。
    """
    found: list[FieldError] = []
    for binding in bindings:
        found.extend(_check_kind(binding))
        found.extend(_check_point(binding, known_node_keys=known_node_keys))
    return found


def referenced_node_keys(bindings: Sequence[BindingDraft]) -> frozenset[str]:
    """这批绑定引用到的全部点位身份。

    Args: bindings。
    """
    return frozenset(
        key for binding in bindings if (key := _point_key(binding)) is not None
    )


def _point_key(binding: BindingDraft) -> str | None:
    if binding.source_kind == "opcua":
        return binding.node_key
    if binding.source_kind == "archive":
        detail = binding.detail_json or {}
        raw = detail.get("node_key")
        return raw if isinstance(raw, str) else None
    return None


def _check_slots(
    bindings: Sequence[BindingDraft],
    *,
    module_types: dict[uuid.UUID, str],
    catalog: ModuleCatalog,
) -> list[FieldError]:
    found: list[FieldError] = []
    for binding in bindings:
        module_type = module_types.get(binding.node_id)
        if module_type is None:
            continue
        slots = catalog.slots(module_type)
        if not _slot_exists(binding.field_key, slots):
            found.append(
                FieldError(
                    field=at_field(binding.field_path, "field_key"),
                    code="field_key_unknown",
                    message=(
                        f"模块 {module_type} 没有绑定槽 " f"{binding.field_key}"
                    ),
                )
            )
    return found


def _slot_exists(field_key: str, slots: ModuleSlots) -> bool:
    parsed = parse_field_key(field_key)
    if parsed is None:
        return False
    if parsed.array_index is None:
        return parsed.slot in slots.scalar_keys
    sub_keys = slots.array_fields.get(parsed.slot)
    return sub_keys is not None and parsed.sub_key in sub_keys


def _check_duplicates(bindings: Sequence[BindingDraft]) -> list[FieldError]:
    seen: set[tuple[uuid.UUID, str]] = set()
    found: list[FieldError] = []
    for binding in bindings:
        identity = (binding.node_id, binding.field_key)
        if identity in seen:
            found.append(
                FieldError(
                    field=at_field(binding.field_path, "field_key"),
                    code="field_key_taken",
                    message=f"这个绑定槽已经绑过了：{binding.field_key}",
                )
            )
            continue
        seen.add(identity)
    return found


def _check_array_runs(bindings: Sequence[BindingDraft]) -> list[FieldError]:
    used: defaultdict[tuple[uuid.UUID, str], set[int]] = defaultdict(set)
    anchors: dict[tuple[uuid.UUID, str], BindingDraft] = {}
    for binding in bindings:
        parsed = parse_field_key(binding.field_key)
        if parsed is None or parsed.array_index is None:
            continue
        slot = (binding.node_id, parsed.slot)
        used[slot].add(parsed.array_index)
        anchors[slot] = binding
    return [
        FieldError(
            field=at_field(anchors[slot].field_path, "field_key"),
            code="array_index_gap",
            message=f"数组槽的索引必须连续且从 0 起：{slot[1]}",
        )
        for slot, indexes in used.items()
        if indexes != set(range(len(indexes)))
    ]


def _check_kind(binding: BindingDraft) -> list[FieldError]:
    if binding.source_kind not in SOURCE_KINDS:
        return [
            FieldError(
                field=at_field(binding.field_path, "source_kind"),
                code="source_kind_unknown",
                message=f"绑定来源未注册：{binding.source_kind}",
            )
        ]
    name, message = _REQUIRED_PAYLOAD[binding.source_kind]
    if not _payload_given(binding, name):
        return [
            FieldError(
                field=at_field(binding.field_path, name),
                code="source_payload_missing",
                message=message,
            )
        ]
    return _check_compute(binding)


def _payload_given(binding: BindingDraft, name: str) -> bool:
    given = {
        "node_key": binding.node_key is not None,
        "static_value_json": binding.has_static_value,
        "compute_json": binding.compute_json is not None,
        "detail_json": binding.detail_json is not None,
    }
    return given[name]


def _check_compute(binding: BindingDraft) -> list[FieldError]:
    if binding.source_kind != "computed":
        return []
    spec = binding.compute_json or {}
    operator = spec.get("op")
    inputs = spec.get("inputs")
    is_well_formed = (
        isinstance(operator, str)
        and operator in COMPUTE_OPS
        and isinstance(inputs, list)
        and len(cast("list[object]", inputs)) > 0
    )
    if is_well_formed:
        return []
    return [
        FieldError(
            field=at_field(binding.field_path, "compute_json"),
            code="compute_spec_invalid",
            message="派生规格要有已注册的 op 与非空的 inputs",
        )
    ]


def _check_point(
    binding: BindingDraft, *, known_node_keys: frozenset[str]
) -> list[FieldError]:
    key = _point_key(binding)
    if key is None:
        return []
    name = "node_key" if binding.source_kind == "opcua" else "detail_json"
    try:
        split_node_key(key)
    except InvalidNodeKey:
        return [
            FieldError(
                field=at_field(binding.field_path, name),
                code="node_key_malformed",
                message="点位身份要写成 {source_id}:{point_code}",
            )
        ]
    if key in known_node_keys:
        return []
    return [
        FieldError(
            field=at_field(binding.field_path, name),
            code="point_not_found",
            message=f"点位不存在：{key}",
        )
    ]
