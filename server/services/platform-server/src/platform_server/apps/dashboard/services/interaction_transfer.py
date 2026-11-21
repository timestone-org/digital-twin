"""大屏包在运行时节点 ID 与包内稳定键之间转换联动引用。"""

import uuid
from collections.abc import Callable, Mapping
from copy import deepcopy
from typing import Any, cast

from lib.errors import FieldError
from platform_server.apps.dashboard.errors import ExportPayloadInvalid

type _Mapper = Callable[[object], object]
type _AtField = Callable[[object, str], object]


class _ReferenceError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def export_node_references(
    chrome: dict[str, Any], node_keys: Mapping[uuid.UUID, str]
) -> dict[str, Any]:
    """将本屏联动节点打包为 client_key。Args: chrome, node_keys。"""

    def pack(value: object) -> dict[str, str]:
        node_id = _uuid(value)
        if node_id is None or node_id not in node_keys:
            raise _ReferenceError(
                "interaction_node_not_found",
                "联动指向的本屏节点已不存在，请先修正联动",
            )
        return {"client_key": node_keys[node_id]}

    return _rewrite(chrome, pack)


def import_node_references(
    chrome: dict[str, Any],
    node_ids: Mapping[str, uuid.UUID],
    choices: Mapping[str, str] | None,
    *,
    should_keep_unmapped: bool,
) -> dict[str, Any]:
    """按本次导入分配的 ID 重建引用，补选仅对包内节点有效。

    Args: chrome, node_ids, choices, should_keep_unmapped。
    """

    selected: set[str] = set()

    def bind(value: object) -> object:
        if isinstance(value, str):
            if value in node_ids and _uuid(value) is None:
                return str(node_ids[value])
            if choices is not None and value in choices:
                selected.add(value)
                return _local_id(choices[value], node_ids)
            if should_keep_unmapped and choices is None:
                return value
            raise _ReferenceError(
                "interaction_node_mapping_required",
                f"请为旧联动引用「{value}」选择包内节点",
            )
        return _tagged_id(value, node_ids)

    result = _rewrite(chrome, bind)
    unused = [key for key in choices or () if key not in selected]
    if unused:
        raise ExportPayloadInvalid(
            "补选包含不需要映射的节点",
            details=tuple(
                FieldError(
                    field=f"interaction_node_map.{key}",
                    code="interaction_node_choice_unused",
                    message="仅可为包中未定位的旧联动引用补选节点",
                )
                for key in unused
            ),
        )
    return result


def _tagged_id(value: object, node_ids: Mapping[str, uuid.UUID]) -> str:
    tagged = _record(value)
    key = tagged.get("client_key")
    if set(tagged) != {"client_key"} or not isinstance(key, str):
        raise _ReferenceError(
            "interaction_node_reference_invalid",
            "联动节点引用需要一个 client_key",
        )
    return _local_id(key, node_ids)


def _uuid(value: object) -> uuid.UUID | None:
    if not isinstance(value, str):
        return None
    try:
        return uuid.UUID(value)
    except ValueError:
        return None


def _local_id(key: str, node_ids: Mapping[str, uuid.UUID]) -> str:
    if key not in node_ids:
        raise _ReferenceError(
            "interaction_node_key_unknown", f"包内没有节点「{key}」"
        )
    return str(node_ids[key])


def _record(value: object) -> dict[str, Any]:
    return cast("dict[str, Any]", value) if isinstance(value, dict) else {}


def _members(value: object, path: str, issues: list[FieldError]) -> list[Any]:
    if isinstance(value, list):
        return cast("list[Any]", value)
    issues.append(
        FieldError(
            field=path,
            code="interaction_list_invalid",
            message="联动字段需要数组",
        )
    )
    return []


def _rewrite(chrome: dict[str, Any], mapper: _Mapper) -> dict[str, Any]:
    """转换本屏引用，保留扩展字段与跨屏句柄。

    Args: chrome, mapper。
    """
    result = deepcopy(chrome)
    issues: list[FieldError] = []

    def at_field(value: object, path: str) -> object:
        try:
            return mapper(value)
        except _ReferenceError as error:
            issues.append(
                FieldError(field=path, code=error.code, message=str(error))
            )
            return value

    path = "chrome_json.interactions"
    for index, raw in enumerate(
        _members(result.get("interactions", []), path, issues)
    ):
        current = f"{path}[{index}]"
        rule = _record(raw)
        if not isinstance(raw, dict):
            issues.append(
                FieldError(
                    field=current,
                    code="interaction_rule_invalid",
                    message="联动规则需要对象",
                )
            )
            continue
        _rule(rule, current, at_field, issues)
    if issues:
        raise ExportPayloadInvalid(
            "有联动引用需要核对，请先选择对应节点", details=tuple(issues)
        )
    return result


def _rule(
    rule: dict[str, Any],
    path: str,
    translate: _AtField,
    issues: list[FieldError],
) -> None:
    source = _record(rule.get("source"))
    if "source" in rule:
        source["nodeId"] = translate(
            source.get("nodeId"), f"{path}.source.nodeId"
        )
    action = _record(rule.get("action"))
    kind = action.get("type")
    action_path = f"{path}.action"
    if kind in ("show", "hide", "toggle"):
        _targets(action, action_path, translate, issues)
    elif kind == "setActive":
        for index, group in enumerate(
            _members(action.get("groups"), f"{action_path}.groups", issues)
        ):
            _targets(
                _record(group),
                f"{action_path}.groups[{index}]",
                translate,
                issues,
            )
    elif kind == "openModal":
        action["target"] = translate(
            action.get("target"), f"{action_path}.target"
        )


def _targets(
    owner: dict[str, Any],
    path: str,
    translate: _AtField,
    issues: list[FieldError],
) -> None:
    values = _members(owner.get("targets"), f"{path}.targets", issues)
    for index, value in enumerate(values):
        values[index] = translate(value, f"{path}.targets[{index}]")
