#!/usr/bin/env python3
"""结构闸：把 project-structure-python.md §7 的八条铁律做成红灯。

这些规则靠评审记忆守不住——违反了不会报错、不会有类型错误、CI 全绿，
几个月后就变成「几份互不相同、没人知道哪份正确」的代码。
"""

from __future__ import annotations

import ast
import re
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SERVER = ROOT / "server"
LIB_SRC = SERVER / "lib" / "src"
SERVICES = SERVER / "services"

# lib 内出现即失败。判据不是「只有本项目在用」，而是
# 「把它整个目录拷到一个完全无关的新项目里，还成不成立」。
PROJECT_NOUNS = re.compile(
    r"数字孪生|孪生|digitaltwin|大屏|看板|dashboard|opcua|点位|台账"
    r"|dataset|归档|报表|modeling|auth-server|platform-server",
    re.IGNORECASE,
)

FORBIDDEN_SERVICE_PACKAGES = {"core", "config", "utils"}


@dataclass
class Violation:
    rule: str
    where: str
    detail: str


def iter_python(root: Path) -> list[Path]:
    return [
        path
        for path in root.rglob("*.py")
        if ".venv" not in path.parts and "__pycache__" not in path.parts
    ]


def imported_modules(path: Path) -> set[str]:
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except SyntaxError:
        return set()
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
    return names


def check_lib_has_no_project_nouns() -> list[Violation]:
    found: list[Violation] = []
    for path in iter_python(LIB_SRC):
        for number, line in enumerate(
            path.read_text(encoding="utf-8").splitlines(), start=1
        ):
            match = PROJECT_NOUNS.search(line)
            if match:
                found.append(
                    Violation(
                        "lib 内不许出现项目名词",
                        f"{path.relative_to(ROOT)}:{number}",
                        match.group(0),
                    )
                )
    return found


def check_lib_imports_nothing_above() -> list[Violation]:
    found: list[Violation] = []
    for path in iter_python(LIB_SRC):
        for module in imported_modules(path):
            head = module.split(".")[0]
            if head in {"domain"} or head.endswith("_server") or head in {
                "auth_server",
            }:
                found.append(
                    Violation(
                        "lib 不许 import domain 或 services",
                        str(path.relative_to(ROOT)),
                        module,
                    )
                )
    return found


def check_lib_utils_is_a_leaf() -> list[Violation]:
    found: list[Violation] = []
    utils = LIB_SRC / "lib" / "utils"
    for path in iter_python(utils):
        for module in imported_modules(path):
            if module.startswith("lib.") and not module.startswith(
                "lib.utils"
            ):
                found.append(
                    Violation(
                        "lib.utils 是叶子，不许 import lib 的其它子包",
                        str(path.relative_to(ROOT)),
                        module,
                    )
                )
    return found


def service_packages() -> dict[str, Path]:
    packages: dict[str, Path] = {}
    for service in sorted(p for p in SERVICES.iterdir() if p.is_dir()):
        src = service / "src"
        if not src.is_dir():
            continue
        for package in src.iterdir():
            if package.is_dir() and not package.name.startswith("_"):
                packages[package.name] = package
    return packages


def check_services_do_not_import_each_other() -> list[Violation]:
    packages = service_packages()
    found: list[Violation] = []
    for name, package in packages.items():
        others = set(packages) - {name}
        for path in iter_python(package):
            for module in imported_modules(path):
                if module.split(".")[0] in others:
                    found.append(
                        Violation(
                            "服务之间不许互相 import",
                            str(path.relative_to(ROOT)),
                            module,
                        )
                    )
    return found


def check_no_core_config_utils_packages() -> list[Violation]:
    found: list[Violation] = []
    for name, package in service_packages().items():
        for child in package.iterdir():
            if child.is_dir() and child.name in FORBIDDEN_SERVICE_PACKAGES:
                found.append(
                    Violation(
                        "服务下不许出现 core/ config/ utils/ 顶层包",
                        str(child.relative_to(ROOT)),
                        f"{name}.{child.name}",
                    )
                )
    return found


def check_apps_do_not_import_scripts() -> list[Violation]:
    found: list[Violation] = []
    for _, package in service_packages().items():
        apps = package / "apps"
        if not apps.is_dir():
            continue
        for path in iter_python(apps):
            for module in imported_modules(path):
                if module == "scripts" or module.startswith("scripts."):
                    found.append(
                        Violation(
                            "脚本不许进生产路径",
                            str(path.relative_to(ROOT)),
                            module,
                        )
                    )
    return found


def check_production_code_avoids_testing_package() -> list[Violation]:
    found: list[Violation] = []
    roots = [LIB_SRC, *(p for p in service_packages().values())]
    for root in roots:
        for path in iter_python(root):
            if "testing" in path.parts or "tests" in path.parts:
                continue
            for module in imported_modules(path):
                if module.startswith("lib.testing"):
                    found.append(
                        Violation(
                            "生产代码不许 import lib.testing",
                            str(path.relative_to(ROOT)),
                            module,
                        )
                    )
    return found


def check_migrations_touch_one_schema_only() -> list[Violation]:
    found: list[Violation] = []
    known = {"auth", "platform", "collect", "realtime", "assistant"}
    for service in sorted(p for p in SERVICES.iterdir() if p.is_dir()):
        own = service.name.removesuffix("-server").replace("-", "_")
        own = {"collector": "collect", "realtime_hub": "realtime"}.get(
            own, own
        )
        versions = service / "migrations" / "versions"
        if not versions.is_dir():
            continue
        for path in versions.glob("*.py"):
            text = path.read_text(encoding="utf-8")
            for schema in known - {own}:
                if f'"{schema}.' in text or f"schema='{schema}'" in text:
                    found.append(
                        Violation(
                            "一个服务的迁移不许动别的 schema",
                            str(path.relative_to(ROOT)),
                            schema,
                        )
                    )
    return found


CHECKS = (
    check_lib_has_no_project_nouns,
    check_lib_imports_nothing_above,
    check_lib_utils_is_a_leaf,
    check_services_do_not_import_each_other,
    check_no_core_config_utils_packages,
    check_apps_do_not_import_scripts,
    check_production_code_avoids_testing_package,
    check_migrations_touch_one_schema_only,
)


def main() -> int:
    """跑全部结构检查；有违规就逐条打印并以非零码退出。"""
    violations: list[Violation] = []
    for check in CHECKS:
        violations.extend(check())
    if not violations:
        sys.stdout.write(f"结构检查通过（{len(CHECKS)} 项）\n")
        return 0
    for item in violations:
        sys.stderr.write(f"[{item.rule}] {item.where} → {item.detail}\n")
    sys.stderr.write(f"\n共 {len(violations)} 处违规\n")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
