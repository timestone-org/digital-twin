#!/usr/bin/env python3
"""镜像闸：Dockerfile 必须拷齐它依赖的每个 workspace 成员。

⚠ 这条只在**真构建镜像**时才暴露，而流水线不建镜像（镜像断言在 nightly）。
于是「测试全绿、合进 main、部署当场起不来」是它的标准剧本：`uv sync --frozen`
按锁文件找本地成员，少拷一个就报 `Distribution not found at file:///src/...`，
而报错发生在装依赖那层，与「谁依赖了它」隔着两个文件。
"""

from __future__ import annotations

import re
import tomllib
from pathlib import Path

from _report import Violation, at, main, read, service_dirs

# `lib` 与 `domain/*` 都是本仓的 workspace 成员，依赖名即目录名
WORKSPACE_ROOTS = ("lib", "domain")
DEPENDENCY = re.compile(r"^\s*[\"']([a-z][a-z0-9_-]*)")


def _declared_dependencies(service: Path) -> set[str]:
    """读服务 pyproject 的 dependencies，取出裸包名（去掉 extras 与版本）。

    Args: service。
    """
    manifest = service / "pyproject.toml"
    if not manifest.is_file():
        return set()
    data = tomllib.loads(read(manifest))
    project = data.get("project", {})
    raw = project.get("dependencies", [])
    names: set[str] = set()
    for item in raw:
        if not isinstance(item, str):
            continue
        names.add(re.split(r"[\[<>=!~ ]", item, maxsplit=1)[0].strip())
    return names


def _workspace_members() -> dict[str, str]:
    """本仓 workspace 成员 → 相对 server/ 的目录。"""
    members: dict[str, str] = {}
    root = Path("server")
    for parent in WORKSPACE_ROOTS:
        base = root / parent
        if not base.is_dir():
            continue
        own = (base / "pyproject.toml").is_file()
        candidates = [base] if own else list(base.iterdir())
        for path in candidates:
            manifest = path / "pyproject.toml"
            if not manifest.is_file():
                continue
            data = tomllib.loads(read(manifest))
            name = data.get("project", {}).get("name")
            if isinstance(name, str):
                members[name] = str(path.relative_to(root))
    return members


def check_dockerfile_copies_every_member_it_needs() -> list[Violation]:
    """依赖了哪个 workspace 成员，Dockerfile 就要拷它的 pyproject 与源码。"""
    members = _workspace_members()
    found: list[Violation] = []
    for service in service_dirs():
        dockerfile = service / "Dockerfile"
        if not dockerfile.is_file():
            continue
        text = read(dockerfile)
        for dependency in sorted(_declared_dependencies(service)):
            directory = members.get(dependency)
            if directory is None:
                continue
            if f"{directory}/pyproject.toml" not in text:
                found.append(
                    Violation(
                        "Dockerfile 少拷 workspace 成员的 pyproject",
                        at(dockerfile),
                        f"依赖 {dependency}，需拷 {directory}/pyproject.toml",
                    )
                )
            if f"COPY {directory}/ " not in text:
                found.append(
                    Violation(
                        "Dockerfile 少拷 workspace 成员的源码",
                        at(dockerfile),
                        f"依赖 {dependency}，需 COPY {directory}/ {directory}/",
                    )
                )
    return found


CHECKS = (check_dockerfile_copies_every_member_it_needs,)


if __name__ == "__main__":
    raise SystemExit(main("镜像 workspace 成员检查", CHECKS))
