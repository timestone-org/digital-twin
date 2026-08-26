#!/usr/bin/env python3
"""前端依赖闸：project-structure-typescript.md §2 与 §7 第 1–2 条。

⚠ TS 的循环依赖不像 Python 那样直接报错，它会让某个 import 在运行时是
`undefined`——表现为「这个组件有时候渲染不出来」。分层反向依赖同理：
它不会报错，只会让整张图的底座慢慢塌掉。
"""

from __future__ import annotations

import re
from pathlib import Path

from _report import (
    WEB,
    Violation,
    at,
    main,
    read,
    strip_ts_comments,
    web_sources,
)

# 与 project-structure-typescript.md §2 的依赖表逐行对应，只能向上依赖
ALLOWED: dict[str, frozenset[str]] = {
    "contracts": frozenset(),
    "tokens": frozenset(),
    "security": frozenset(),
    "twin-config": frozenset({"contracts"}),
    "datasources": frozenset({"contracts"}),
    "ui": frozenset({"contracts", "tokens"}),
    "three-core": frozenset({"contracts", "tokens", "twin-config", "ui"}),
    "twin2d": frozenset({"contracts", "ui"}),
    "modules": frozenset(
        {"contracts", "three-core", "tokens", "twin-config", "twin2d", "ui"}
    ),
    "runtime": frozenset({"contracts", "modules", "security", "ui"}),
}

IMPORT = re.compile(
    r"""(?:import|export)[\s\S]*?from\s*['"](?P<target>[^'"]+)['"]"""
)
DYNAMIC_IMPORT = re.compile(r"""import\s*\(\s*['"](?P<target>[^'"]+)['"]""")
PACKAGE_IMPORT = re.compile(r"^@dt/(?P<name>[a-z][a-z0-9-]*)")
EXTENSIONS = (".ts", ".vue", ".tsx", "/index.ts", "/index.vue")


def _package_of(path: Path) -> str | None:
    parts = path.parts
    if "packages" not in parts:
        return None
    return parts[parts.index("packages") + 1]


def _imports(path: Path) -> list[str]:
    text = strip_ts_comments(read(path))
    targets = [match.group("target") for match in IMPORT.finditer(text)]
    targets.extend(
        match.group("target") for match in DYNAMIC_IMPORT.finditer(text)
    )
    return targets


def check_packages_declare_their_layer() -> list[Violation]:
    """新增一个包必须先在依赖表里登记，否则分层闸对它形同虚设。"""
    packages = WEB / "packages"
    if not packages.is_dir():
        return []
    return [
        Violation(
            "新增包必须先登记进依赖表",
            at(directory),
            f"{directory.name} 不在 project-structure-typescript.md §2 的表里",
        )
        for directory in sorted(packages.iterdir())
        if directory.is_dir() and directory.name not in ALLOWED
    ]


def check_layer_direction() -> list[Violation]:
    """箭头只能向上，反向即违规。"""
    found: list[Violation] = []
    for path in web_sources():
        owner = _package_of(path)
        if owner is None or owner not in ALLOWED:
            continue
        for target in _imports(path):
            match = PACKAGE_IMPORT.match(target)
            if match is None:
                continue
            name = match.group("name")
            if name == owner or name in ALLOWED[owner]:
                continue
            found.append(
                Violation(
                    "包依赖方向违规",
                    at(path),
                    f"@dt/{owner} → @dt/{name}；只能向上依赖",
                )
            )
    return found


def _resolve(path: Path, target: str) -> Path | None:
    """把一条 import 解析成仓内文件；解析不到的是第三方包。

    Args: path, target。
    """
    if target.startswith("."):
        base = (path.parent / target).resolve()
    elif target.startswith("@/"):
        base = WEB / "app" / "src" / target.removeprefix("@/")
    else:
        match = PACKAGE_IMPORT.match(target)
        if match is None:
            return None
        base = WEB / "packages" / match.group("name") / "src" / "index.ts"
    if base.is_file():
        return base
    for suffix in EXTENSIONS:
        candidate = Path(f"{base}{suffix}")
        if candidate.is_file():
            return candidate
    return None


def _graph() -> dict[Path, list[Path]]:
    graph: dict[Path, list[Path]] = {}
    for path in web_sources():
        edges = [_resolve(path, target) for target in _imports(path)]
        graph[path] = [edge for edge in edges if edge is not None]
    return graph


def check_no_import_cycles() -> list[Violation]:
    """零环。成环的那条 import 在运行时可能是 undefined。"""
    graph = _graph()
    seen: set[Path] = set()
    stack: list[Path] = []
    found: list[Violation] = []

    def walk(node: Path) -> None:
        if node in stack:
            cycle = [*stack[stack.index(node) :], node]
            found.append(
                Violation(
                    "禁止循环依赖",
                    at(cycle[0]),
                    " → ".join(item.name for item in cycle),
                )
            )
            return
        if node in seen:
            return
        seen.add(node)
        stack.append(node)
        for child in graph.get(node, []):
            walk(child)
        stack.pop()

    for node in sorted(graph):
        walk(node)
    return found


CHECKS = (
    check_packages_declare_their_layer,
    check_layer_direction,
    check_no_import_cycles,
)


if __name__ == "__main__":
    raise SystemExit(main("前端依赖图检查", CHECKS))
