#!/usr/bin/env python3
"""后端结构闸：把 project-structure-python.md §7 的八条铁律做成红灯。

这些规则靠评审记忆守不住——违反了不会报错、不会有类型错误、CI 全绿，
几个月后就变成「几份互不相同、没人知道哪份正确」的代码。
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

from _report import (
    PY,
    ROOT,
    SERVER,
    Violation,
    at,
    iter_files,
    main,
    parse,
    read,
    service_dirs,
)

LIB_SRC = SERVER / "lib" / "src"
DOMAIN = SERVER / "domain"

# lib 内出现即失败。判据不是「只有本项目在用」，而是
# 「把它整个目录拷到一个完全无关的新项目里，还成不成立」。
PROJECT_NOUNS = re.compile(
    r"数字孪生|孪生|digitaltwin|大屏|看板|dashboard|opcua|点位|台账"
    r"|dataset|归档|报表|modeling|auth-server|platform-server",
    re.IGNORECASE,
)
FORBIDDEN_SERVICE_PACKAGES = frozenset({"core", "config", "utils"})
# domain 含了这些就等于两个服务共享数据库写路径，ADR-0003 的写独占会静默失效
PERSISTENCE_MARKERS = re.compile(
    r"\bDeclarativeBase\b|\bmapped_column\b|\bMapped\[|\bDepends\s*\(|\bAPIRouter\b"
)
REQUIRED_SERVICE_FILES = ("README.md", "CONTEXT.md", "pyproject.toml")
# `<pkg>.apps.<feature>.<layer>` —— 判定越界至少要看到这四段
FEATURE_PATH_DEPTH = 4


def _python(root: Path) -> list[Path]:
    return list(iter_files(root, PY))


def _imports(path: Path) -> set[str]:
    tree = parse(path)
    if tree is None:
        return set()
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
    return names


def check_lib_has_no_project_nouns() -> list[Violation]:
    """lib 里不允许出现任何与本项目相关的名词。不是「尽量少」，是零。"""
    found: list[Violation] = []
    for path in _python(LIB_SRC):
        for number, line in enumerate(read(path).splitlines(), start=1):
            match = PROJECT_NOUNS.search(line)
            if match is not None:
                found.append(
                    Violation(
                        "lib 内不许出现项目名词",
                        at(path, number),
                        match.group(0),
                    )
                )
    return found


def _service_packages() -> dict[str, Path]:
    packages: dict[str, Path] = {}
    for service in service_dirs():
        src = service / "src"
        if not src.is_dir():
            continue
        for package in src.iterdir():
            if package.is_dir() and not package.name.startswith("_"):
                packages[package.name] = package
    return packages


def _domain_packages() -> dict[str, Path]:
    if not DOMAIN.is_dir():
        return {}
    return {
        path.name: path for path in sorted(DOMAIN.iterdir()) if path.is_dir()
    }


def check_lib_imports_nothing_above() -> list[Violation]:
    """lib 不许 import 任何 domain 或 services——反向依赖是环的起点。"""
    upstream = set(_service_packages()) | set(_domain_packages()) | {"domain"}
    return [
        Violation("lib 不许 import domain 或 services", at(path), module)
        for path in _python(LIB_SRC)
        for module in _imports(path)
        if module.split(".")[0] in upstream
    ]


def check_lib_utils_is_a_leaf() -> list[Violation]:
    """lib.utils 是叶子，不许 import lib 的其它子包。"""
    return [
        Violation("lib.utils 不许 import lib 的其它子包", at(path), module)
        for path in _python(LIB_SRC / "lib" / "utils")
        for module in _imports(path)
        if module.startswith("lib.") and not module.startswith("lib.utils")
    ]


def check_services_do_not_import_each_other() -> list[Violation]:
    """跨服务只走 HTTP / WebSocket / 消息通道 / 只读 SQL。"""
    packages = _service_packages()
    return [
        Violation("服务之间不许互相 import", at(path), module)
        for name, package in packages.items()
        for path in _python(package)
        for module in _imports(path)
        if module.split(".")[0] in set(packages) - {name}
    ]


def check_feature_modules_use_public_face() -> list[Violation]:
    """`apps/<A>` 只走 `apps/<B>` 的 services 公开面，不许伸进它的内部。"""
    found: list[Violation] = []
    for package in _service_packages().values():
        apps = package / "apps"
        if not apps.is_dir():
            continue
        for feature in sorted(path for path in apps.iterdir() if path.is_dir()):
            found.extend(_cross_feature(package, apps, feature))
    return found


def _cross_feature(package: Path, apps: Path, feature: Path) -> list[Violation]:
    others = {
        path.name
        for path in apps.iterdir()
        if path.is_dir() and path.name != feature.name
    }
    return [
        Violation("跨功能模块只走 services 公开面", at(path), module)
        for path in _python(feature)
        for module in _imports(path)
        if _reaches_inside(module, package.name, others)
    ]


def _reaches_inside(module: str, package: str, others: set[str]) -> bool:
    """伸进了别的功能模块的内部（而不是它的 services 公开面）。

    Args: module, package, others。
    """
    parts = module.split(".")
    if len(parts) < FEATURE_PATH_DEPTH:
        return False
    if parts[0] != package or parts[1] != "apps":
        return False
    return parts[2] in others and parts[3] != "services"


def check_no_core_config_utils_packages() -> list[Violation]:
    """服务下不再有 core/、config/、utils/。出现即为回归。"""
    return [
        Violation(
            "服务下不许出现 core/ config/ utils/ 顶层包",
            at(child),
            f"{name}.{child.name}",
        )
        for name, package in _service_packages().items()
        for child in package.iterdir()
        if child.is_dir() and child.name in FORBIDDEN_SERVICE_PACKAGES
    ]


def check_domain_stays_flat() -> list[Violation]:
    """domain/* 不许 import services，也不许互相 import。"""
    packages = _domain_packages()
    services = set(_service_packages())
    found: list[Violation] = []
    for name, package in packages.items():
        forbidden = (set(packages) - {name}) | services
        found.extend(
            Violation("domain/* 不许 import 服务或彼此", at(path), module)
            for path in _python(package)
            for module in _imports(path)
            if module.split(".")[0] in forbidden
        )
    return found


def check_domain_has_no_persistence() -> list[Violation]:
    """⚠ domain 里出现 ORM 模型或依赖注入件，写独占就会静默失效。"""
    found: list[Violation] = []
    for package in _domain_packages().values():
        found.extend(
            Violation(
                "domain/* 不许含 ORM 模型、CRUD 与依赖注入件",
                at(path),
                found_marker.group(0),
            )
            for path in _python(package)
            if (found_marker := PERSISTENCE_MARKERS.search(read(path)))
        )
    return found


def check_apps_do_not_import_scripts() -> list[Violation]:
    """脚本不许进生产路径。"""
    found: list[Violation] = []
    for package in _service_packages().values():
        apps = package / "apps"
        if not apps.is_dir():
            continue
        found.extend(
            Violation("脚本不许进生产路径", at(path), module)
            for path in _python(apps)
            for module in _imports(path)
            if module == "scripts" or module.startswith("scripts.")
        )
    return found


def check_production_code_avoids_testing_package() -> list[Violation]:
    """lib.testing 是测试设施，生产代码引用它会把假件带进产物。"""
    roots = [
        LIB_SRC,
        *_service_packages().values(),
        *_domain_packages().values(),
    ]
    return [
        Violation("生产代码不许 import lib.testing", at(path), module)
        for root in roots
        for path in _python(root)
        if "testing" not in path.parts and "tests" not in path.parts
        for module in _imports(path)
        if module.startswith("lib.testing")
    ]


def _own_schema(service: Path) -> str:
    name = service.name.removesuffix("-server").replace("-", "_")
    return {"collector": "collect", "realtime_hub": "realtime"}.get(name, name)


def check_migrations_touch_one_schema_only() -> list[Violation]:
    """⚠ 一个服务的迁移里出现另一个 schema 的名字，即为写权限越界。"""
    known = {"auth", "platform", "collect", "realtime", "assistant"}
    found: list[Violation] = []
    for service in service_dirs():
        own = _own_schema(service)
        versions = service / "migrations" / "versions"
        if not versions.is_dir():
            continue
        found.extend(
            Violation("一个服务的迁移不许动别的 schema", at(path), schema)
            for path in sorted(versions.glob("*.py"))
            for schema in sorted(known - {own})
            if _mentions_schema(read(path), schema)
        )
    return found


def _mentions_schema(text: str, schema: str) -> bool:
    return f'"{schema}.' in text or f"schema='{schema}'" in text


def check_services_are_documented() -> list[Violation]:
    """每个服务各出一份 README 与 CONTEXT，上下文地图才对得上。"""
    return [
        Violation("服务缺必备文件", at(service), name)
        for service in service_dirs()
        for name in REQUIRED_SERVICE_FILES
        if not (service / name).is_file()
    ]


def check_context_map_is_complete() -> list[Violation]:
    """CONTEXT-MAP.md 必须提到每个已建成的服务。"""
    context_map = ROOT / "CONTEXT-MAP.md"
    if not context_map.is_file():
        return [Violation("缺 CONTEXT-MAP.md", at(ROOT), "上下文地图是入口")]
    text = read(context_map)
    return [
        Violation("CONTEXT-MAP.md 未登记该服务", at(context_map), service.name)
        for service in service_dirs()
        if service.name not in text
    ]


CHECKS = (
    check_lib_has_no_project_nouns,
    check_lib_imports_nothing_above,
    check_lib_utils_is_a_leaf,
    check_services_do_not_import_each_other,
    check_feature_modules_use_public_face,
    check_no_core_config_utils_packages,
    check_domain_stays_flat,
    check_domain_has_no_persistence,
    check_apps_do_not_import_scripts,
    check_production_code_avoids_testing_package,
    check_migrations_touch_one_schema_only,
    check_services_are_documented,
    check_context_map_is_complete,
)


if __name__ == "__main__":
    raise SystemExit(main("后端结构检查", CHECKS))
