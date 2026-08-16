#!/usr/bin/env python3
"""线形覆盖闸：后端每一个出参形状，前端都要有一条钉住它的契约用例。

⚠ 这条闸挡的是本仓真踩过两次的坑：手写的前端类型比真接口**宽松**时，
typecheck、lint 与单测**全绿**——编译器无从知道后端叫什么。两次的表现分别是
「整页崩在渲染里」（`UserListItem` 被写成了 `AuthUser`）与「默认值恒空、
徽标永远不亮」（`default_value` 被写成了 `default`）。

两次都是补出来的用例，而补的前提是有人先想到。这条闸把「想到」换成红灯：
`openapi.json` 里能从 2xx 响应走到的每一个出参形状，都必须在
`web/app/tests/contract/` 的某条用例里被点名，或者在下面的豁免表里写明理由。

⚠ 它只管**有没有人钉**，不管钉得对不对：键集比对必须在 TS 那侧做，因为只有
类型系统数得清 `keyof T`。两者缺一不可。
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import cast

from _report import ROOT, Violation, at, main, read

CONTRACT_TESTS = ROOT / "web" / "app" / "tests" / "contract"
SERVICES = ROOT / "server" / "services"

# 信封与分页是泛型容器，形状由 `ApiEnvelope` / `Page` 两个类型一次钉死
WRAPPERS = re.compile(r"^(?:ApiResponse|Page|CursorPage)_")
# 错误体的形状由统一信封的契约用例管，不逐个端点钉
ERROR_SHAPES = re.compile(r"Error|HTTPValidation|FieldError|^Body_")

# 键是 `<服务目录>:<形状名>`。⚠ 只有「前端不按类型读它」才算理由，
# 「还没来得及写」不算——那正是这条闸要拦的东西
_CATALOG_IS_FRONTEND_OWNED = (
    "模块清单的真源在前端，服务端那份是构建期导出的产物；"
    "两侧逐字一致由 web/packages/modules/tests/catalog.contract.spec.ts 守"
)
_PARSED_FIELD_BY_FIELD = (
    "导出包来自用户随手挑的文件，由 dashboardTransferWire 逐字段窄化、"
    "认不出就抛——键名不对是当场失败，不是静默读到 undefined"
)
_NO_CONSUMER = "前端不调 `:aggregate`，分桶聚合眼下只有后端自己用"
EXEMPT: dict[str, str] = {
    "platform-server:AggregateOut": _NO_CONSUMER,
    "platform-server:AggregateBucketOut": _NO_CONSUMER,
    "platform-server:ModuleCatalogOut": _CATALOG_IS_FRONTEND_OWNED,
    "platform-server:ModuleTypeOut": _CATALOG_IS_FRONTEND_OWNED,
    "platform-server:BindingSpecOut": _CATALOG_IS_FRONTEND_OWNED,
    "platform-server:ConfigFieldOut": _CATALOG_IS_FRONTEND_OWNED,
    "platform-server:ConfigOptionOut": _CATALOG_IS_FRONTEND_OWNED,
    "platform-server:ConfigFieldConditionOut": _CATALOG_IS_FRONTEND_OWNED,
    "platform-server:ModuleDefaultSizeOut": _CATALOG_IS_FRONTEND_OWNED,
    "platform-server:DashboardExportOut": _PARSED_FIELD_BY_FIELD,
    "platform-server:UnresolvedBindingOut": _PARSED_FIELD_BY_FIELD,
    "platform-server:ExportNodeIn": _PARSED_FIELD_BY_FIELD,
    "platform-server:ExportBindingIn": _PARSED_FIELD_BY_FIELD,
}


def _spec_files() -> list[Path]:
    return sorted(SERVICES.glob("*/openapi.json"))


def _leaf_output_shapes(spec: dict[str, object]) -> set[str]:
    """从每个 2xx 响应出发，走到全部叶子出参形状。

    Args: spec。
    """
    schemas = cast("dict[str, object]", spec.get("components", {}))
    known = cast("dict[str, object]", schemas.get("schemas", {}))
    seen: set[str] = set()
    for response in _success_responses(spec):
        _walk(response, known, seen)
    return {
        name
        for name in seen
        if not WRAPPERS.match(name) and not ERROR_SHAPES.search(name)
    }


def _success_responses(spec: dict[str, object]) -> list[object]:
    """全部 2xx 响应体。

    Args: spec。
    """
    found: list[object] = []
    paths = cast("dict[str, object]", spec.get("paths", {}))
    for operations in paths.values():
        for operation in cast("dict[str, object]", operations).values():
            if not isinstance(operation, dict):
                continue
            responses = cast("dict[str, object]", operation).get("responses")
            found.extend(
                response
                for code, response in cast(
                    "dict[str, object]", responses or {}
                ).items()
                if code.startswith("2")
            )
    return found


def _walk(node: object, known: dict[str, object], seen: set[str]) -> None:
    """顺着 `$ref` 把能走到的形状名都收进 `seen`。

    Args: node, known, seen。
    """
    if isinstance(node, list):
        for item in cast("list[object]", node):
            _walk(item, known, seen)
        return
    if not isinstance(node, dict):
        return
    fields = cast("dict[str, object]", node)
    reference = fields.get("$ref")
    if isinstance(reference, str):
        name = reference.rsplit("/", maxsplit=1)[-1]
        if name not in seen:
            seen.add(name)
            _walk(known.get(name), known, seen)
    for value in fields.values():
        _walk(value, known, seen)


def _pinned() -> dict[str, set[str]]:
    """契约用例里被点名的形状名，**按它读的是哪个服务的 openapi 归属**。

    ⚠ 归属不能省：`NodeOut` 在 opcua 是节点、在 platform 是画布节点，两个完全
    不同的形状同名。不按服务分，钉住一个就等于把另一个也算成钉过了。

    两种写法都算数：当成键写（`UserListItemOut: {…}`）与当成串写
    （`schemas['RuntimeParamOut']`）。
    Args: 无。
    """
    found: dict[str, set[str]] = {}
    if not CONTRACT_TESTS.is_dir():
        return found
    key = re.compile(r"^\s*(?P<name>[A-Z]\w+)\s*:\s*\{", re.MULTILINE)
    quoted = re.compile(r"['\"`](?P<name>[A-Z]\w+)['\"`]")
    service = re.compile(r"['\"`](?P<service>[a-z-]+-(?:server|hub))['\"`]")
    for path in sorted(CONTRACT_TESTS.glob("*.ts")):
        text = read(path)
        owners = {match.group("service") for match in service.finditer(text)}
        if not owners:
            continue
        names = {match.group("name") for match in key.finditer(text)}
        names |= {match.group("name") for match in quoted.finditer(text)}
        for owner in owners:
            found.setdefault(owner, set()).update(names)
    return found


def check_every_output_shape_is_pinned() -> list[Violation]:
    """每个出参形状都要有人钉，或者在豁免表里写明前端不读它。"""
    pinned = _pinned()
    found: list[Violation] = []
    for path in _spec_files():
        service = path.parent.name
        spec = cast("dict[str, object]", json.loads(read(path)))
        for name in sorted(_leaf_output_shapes(spec)):
            if name in pinned.get(service, set()):
                continue
            if f"{service}:{name}" in EXEMPT:
                continue
            found.append(
                Violation(
                    "出参形状没有契约用例钉住",
                    at(path),
                    f"{name}；手写类型比真接口宽松时全绿，只在运行时崩",
                )
            )
    return found


def check_exemptions_still_exist() -> list[Violation]:
    """豁免表不许留下已经不存在的形状名——那会让它悄悄失去意义。"""
    live: set[str] = set()
    for path in _spec_files():
        spec = cast("dict[str, object]", json.loads(read(path)))
        live |= {
            f"{path.parent.name}:{name}" for name in _leaf_output_shapes(spec)
        }
    return [
        Violation(
            "豁免表里的形状已经不存在",
            "scripts/gates/check_wire_shapes.py EXEMPT",
            f"{entry}；删掉它，别让豁免表变成许愿池",
        )
        for entry in sorted(EXEMPT)
        if entry not in live
    ]


CHECKS = (
    check_every_output_shape_is_pinned,
    check_exemptions_still_exist,
)


if __name__ == "__main__":
    raise SystemExit(main("线形覆盖检查", CHECKS))
