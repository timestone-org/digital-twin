#!/usr/bin/env python3
"""对外契约闸：api-contract.md §1、§4、§5、§6。

口径分裂一旦铺开就永远改不回来——每一个已上线的端点都是一个既成事实。
这一组直接读提交进仓的 `openapi.json`，把 URL 形状与序列化口径钉死。
"""

from __future__ import annotations

import ast
import json
import re
from pathlib import Path
from typing import cast

from _report import Violation, at, main, parse, read, service_dirs

# JSON 的边界：`json.loads` 给的是 Any，这里立刻收敛成有类型的映射，
# 不让它流进检查逻辑（见 code-style-python.md §2.2）。
type JsonObject = dict[str, object]

# 对外面带服务段，内部面不带：`/api/v1/<service>/…` 与 `/internal/v1/…`
PATH_PREFIX = re.compile(r"^/(?:api/v\d+/[a-z][a-z0-9-]*|internal/v\d+)(?=/|$)")
SEGMENT = re.compile(r"^[a-z][a-z0-9]*(-[a-z0-9]+)*$")
PARAM = re.compile(r"^\{[a-z_][a-z0-9_]*\}$")
ACTION = re.compile(r"^(?P<resource>[^:]+):(?P<verb>[a-z][a-z0-9-]*)$")
ERROR_CODE = re.compile(r"^[45]\d{4}$")

# 探针与文档端点不是资源，不受复数与形状约束
EXEMPT_SEGMENTS = frozenset(
    {"health", "ready", "docs", "redoc", "openapi.json", "me"}
)
MAX_RESOURCE_DEPTH = 2
MAX_PAGE_SIZE = 200


def _specs() -> list[Path]:
    return [
        service / "openapi.json"
        for service in service_dirs()
        if (service / "openapi.json").is_file()
    ]


def _load(path: Path) -> JsonObject:
    return _as_object(json.loads(read(path)))


def _as_object(value: object) -> JsonObject:
    if isinstance(value, dict):
        return cast("JsonObject", value)
    return {}


def _as_array(value: object) -> list[object]:
    if isinstance(value, list):
        return cast("list[object]", value)
    return []


def _paths(path: Path) -> dict[str, JsonObject]:
    raw = _as_object(_load(path).get("paths"))
    return {url: _as_object(value) for url, value in raw.items()}


def _resource_segments(url: str) -> list[str]:
    body = PATH_PREFIX.sub("", url)
    return [part for part in body.split("/") if part]


def check_url_shape() -> list[Violation]:
    """URL 形状全服务统一：`/api/v1/<service>/<资源复数>`，多词 kebab-case。"""
    found: list[Violation] = []
    for path in _specs():
        for url in sorted(_paths(path)):
            found.extend(_url_violations(path, url))
    return found


def _url_violations(path: Path, url: str) -> list[Violation]:
    if PATH_PREFIX.match(url) is None:
        return [
            Violation(
                "URL 必须是 /api/v1/<service>/… 或 /internal/v1/…",
                at(path),
                url,
            )
        ]
    found: list[Violation] = []
    segments = _resource_segments(url)
    resources = [part for part in segments if not PARAM.match(part)]
    if len(resources) > MAX_RESOURCE_DEPTH + 1:
        found.append(
            Violation(
                f"资源嵌套不许超过 {MAX_RESOURCE_DEPTH} 层",
                at(path),
                f"{url}；第三层起改用顶层资源加过滤",
            )
        )
    found.extend(_segment_violations(path, url, segments))
    return found


def _segment_violations(
    path: Path, url: str, segments: list[str]
) -> list[Violation]:
    found: list[Violation] = []
    for index, segment in enumerate(segments):
        if PARAM.match(segment) or segment in EXEMPT_SEGMENTS:
            continue
        action = ACTION.match(segment)
        name = action.group("resource") if action else segment
        if PARAM.match(name) or name in EXEMPT_SEGMENTS:
            continue
        if not SEGMENT.match(name):
            found.append(
                Violation(
                    "路径段必须是 kebab-case", at(path), f"{url} → {name}"
                )
            )
        elif index == 0 and not name.endswith("s"):
            found.append(
                Violation("资源用复数名词", at(path), f"{url} → {name}")
            )
    return found


def check_action_endpoints_are_post() -> list[Violation]:
    """动作端点一律 POST——GET 带副作用会被各级缓存和预取毁掉。"""
    found: list[Violation] = []
    for path in _specs():
        for url, operations in sorted(_paths(path).items()):
            if ":" not in url.rsplit("/", maxsplit=1)[-1]:
                continue
            wrong = sorted(set(operations) - {"post"})
            if wrong:
                found.append(
                    Violation(
                        "动作端点必须是 POST",
                        at(path),
                        f"{url} 上有 {wrong}",
                    )
                )
    return found


def _walk(node: object) -> list[JsonObject]:
    found: list[JsonObject] = []
    if isinstance(node, dict):
        current = cast("JsonObject", node)
        found.append(current)
        for value in current.values():
            found.extend(_walk(value))
    elif isinstance(node, list):
        for item in cast("list[object]", node):
            found.extend(_walk(item))
    return found


def check_no_numeric_enum() -> list[Violation]:
    """⚠ 数字枚举改一次顺序，就静默改变了全部已存数据的含义。"""
    found: list[Violation] = []
    for path in _specs():
        for node in _walk(_load(path)):
            values = _as_array(node.get("enum"))
            if not values or all(isinstance(item, bool) for item in values):
                continue
            if all(isinstance(item, int | float) for item in values):
                found.append(Violation("禁止数字枚举", at(path), f"{values}"))
    return found


def check_timestamps_are_rfc3339() -> list[Violation]:
    """`_at` 结尾的字段一律 RFC3339 UTC，由 `format: date-time` 声明。"""
    found: list[Violation] = []
    for path in _specs():
        for node in _walk(_load(path)):
            found.extend(
                _timestamp_props(path, _as_object(node.get("properties")))
            )
    return found


def _timestamp_props(path: Path, properties: JsonObject) -> list[Violation]:
    found: list[Violation] = []
    for name, schema in properties.items():
        if not name.endswith("_at"):
            continue
        formats = {node.get("format") for node in _walk(schema)}
        if "date-time" not in formats:
            found.append(
                Violation(
                    "时刻字段必须 format: date-time",
                    at(path),
                    f"{name}",
                )
            )
    return found


def check_pagination_has_a_hard_limit() -> list[Violation]:
    """⚠ 分页无上限时，一个 `size=1000000` 就是一次 OOM。"""
    found: list[Violation] = []
    for path in _specs():
        for url, operations in sorted(_paths(path).items()):
            for method, operation in sorted(operations.items()):
                found.extend(_size_limits(path, url, method, operation))
    return found


def _size_limits(
    path: Path, url: str, method: str, operation: object
) -> list[Violation]:
    found: list[Violation] = []
    for raw in _as_array(_as_object(operation).get("parameters")):
        parameter = _as_object(raw)
        if parameter.get("name") != "size":
            continue
        limits = [
            node["maximum"]
            for node in _walk(parameter.get("schema"))
            if isinstance(node.get("maximum"), int | float)
        ]
        numbers = [value for value in limits if isinstance(value, int | float)]
        if not numbers or max(numbers) > MAX_PAGE_SIZE:
            found.append(
                Violation(
                    f"分页 size 必须有 ≤{MAX_PAGE_SIZE} 的硬上限",
                    at(path),
                    f"{method.upper()} {url}",
                )
            )
    return found


def _error_classes(path: Path) -> list[tuple[str, int | None, int | None]]:
    tree = parse(path)
    if tree is None:
        return []
    found: list[tuple[str, int | None, int | None]] = []
    for node in tree.body:
        if not isinstance(node, ast.ClassDef):
            continue
        values = _class_constants(node)
        if "code" in values:
            found.append(
                (node.name, values.get("code"), values.get("http_status"))
            )
    return found


def _class_constants(node: ast.ClassDef) -> dict[str, int | None]:
    values: dict[str, int | None] = {}
    for item in node.body:
        if not isinstance(item, ast.Assign) or not isinstance(
            item.value, ast.Constant
        ):
            continue
        for target in item.targets:
            if isinstance(target, ast.Name) and isinstance(
                item.value.value, int
            ):
                values[target.id] = item.value.value
    return values


def check_error_codes() -> list[Violation]:
    """错误码分段十进制，且首位必须与 HTTP 状态码的首位一致。"""
    found: list[Violation] = []
    for service in service_dirs():
        for path in sorted((service / "src").rglob("errors.py")):
            seen: dict[int, str] = {}
            for name, code, status in _error_classes(path):
                found.extend(_error_code(path, name, code, status, seen))
    return found


def _error_code(
    path: Path,
    name: str,
    code: int | None,
    status: int | None,
    seen: dict[int, str],
) -> list[Violation]:
    if code is None:
        return []
    if not ERROR_CODE.match(str(code)):
        return [
            Violation("错误码必须是五位分段十进制", at(path), f"{name}={code}")
        ]
    if code in seen:
        return [
            Violation(
                "错误码不许重复",
                at(path),
                f"{code} 同时属于 {seen[code]} 与 {name}",
            )
        ]
    seen[code] = name
    if status is not None and str(code)[0] != str(status)[0]:
        return [
            Violation(
                "错误码首位必须与 HTTP 状态码一致",
                at(path),
                f"{name}: code={code} http={status}",
            )
        ]
    return []


CHECKS = (
    check_url_shape,
    check_action_endpoints_are_post,
    check_no_numeric_enum,
    check_timestamps_are_rfc3339,
    check_pagination_has_a_hard_limit,
    check_error_codes,
)


if __name__ == "__main__":
    raise SystemExit(main("对外契约检查", CHECKS))
