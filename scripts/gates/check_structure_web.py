#!/usr/bin/env python3
"""前端结构闸：project-structure-typescript.md §7 的布局类规则。

这些规则违反了不会报错、不会有类型错误，只会在几个月后变成
「没人敢动的公共模块」与「打进产物的测试文件」。样式与页面布局类的
规则在 `check_web_styles.py`，依赖图在 `check_web_deps.py`。
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from _report import (
    ROOT,
    TS,
    Violation,
    at,
    iter_files,
    main,
    read,
    strip_ts_comments,
    web_members,
)

WEB = ROOT / "web"
PACKAGES = WEB / "packages"
APP = WEB / "app"

TEST_SUFFIX = re.compile(r"\.(test|spec)\.[cm]?[jt]sx?$")
DEEP_LINK = re.compile(r"""from\s+['"]@dt/[a-z-]+/src/""")
APP_IMPORT = re.compile(r"""from\s+['"](@/|.*\bapp/src/)""")
TESTING_IMPORT = re.compile(r"""from\s+['"][^'"]*src/testing""")
PAGE_DIR = re.compile(r"[A-Z][A-Za-z0-9]*")


def _sources(root: Path) -> list[Path]:
    return list(iter_files(root, TS | frozenset({".js"})))


def check_no_tests_beside_sources() -> list[Violation]:
    """src/ 下不许出现测试文件——测试全部收在成员自己的 tests/ 里。"""
    return [
        Violation(
            "测试不许与源码同目录",
            at(path),
            "移到本成员的 tests/ 下，目录镜像 src/",
        )
        for member in web_members()
        for path in _sources(member / "src")
        if TEST_SUFFIX.search(path.name)
    ]


def check_tests_mirror_sources() -> list[Violation]:
    """tests/ 下只放测试，别把被测代码也搬进去。"""
    return [
        Violation(
            "tests/ 下只放测试文件",
            at(path),
            "共用夹具放 src/testing/，被测代码放 src/",
        )
        for member in web_members()
        for path in _sources(member / "tests")
        if not TEST_SUFFIX.search(path.name) and path.name != "setup.ts"
    ]


def check_packages_do_not_import_app() -> list[Violation]:
    """应用壳是终点：被包需要的东西说明它该下沉。"""
    return [
        Violation("packages/* 不许依赖 app/", at(path), "@/ 或 app/src")
        for package in _packages()
        for path in _sources(package)
        if APP_IMPORT.search(read(path))
    ]


def _packages() -> list[Path]:
    if not PACKAGES.is_dir():
        return []
    return sorted(path for path in PACKAGES.iterdir() if path.is_dir())


def check_no_deep_links() -> list[Violation]:
    """深链绕过包的公开面，任何内部重构都会变成破坏性变更。"""
    found: list[Violation] = []
    for member in web_members():
        for path in _sources(member):
            match = DEEP_LINK.search(read(path))
            if match is not None:
                found.append(
                    Violation("不许深链包内部路径", at(path), match.group(0))
                )
    return found


def check_production_avoids_testing_dir() -> list[Violation]:
    """src/testing/ 是测试设施，生产代码引用它会把假件带进产物。"""
    return [
        Violation("生产代码不许引用 src/testing", at(path), "src/testing")
        for member in web_members()
        for path in _sources(member / "src")
        if "testing" not in path.parts and TESTING_IMPORT.search(read(path))
    ]


def check_barrels_only_reexport() -> list[Violation]:
    """包的公开出口只做转出。

    ⚠ 只查 `packages/*/src/index.ts`——那是包的公开面。应用壳里的
    `router/index.ts` 之类只是恰好叫这个名字的普通模块，不是桶文件。
    index.ts 已被排除出覆盖率统计，往里塞逻辑等于把代码藏进盲区。
    """
    found: list[Violation] = []
    for package in _packages():
        barrel = package / "src" / "index.ts"
        if barrel.is_file():
            found.extend(_non_reexport_statements(barrel))
    return found


def _non_reexport_statements(path: Path) -> list[Violation]:
    """按语句而非按行判定：多行 export 的续行不算违规。

    Args: path。
    """
    found: list[Violation] = []
    depth = 0
    for number, raw in enumerate(
        strip_ts_comments(read(path)).splitlines(), start=1
    ):
        line = raw.strip()
        if depth == 0 and line and not line.startswith(("export", "import")):
            found.append(
                Violation(
                    "桶文件只允许 export 语句", at(path, number), line[:40]
                )
            )
        depth += line.count("{") + line.count("(")
        depth -= line.count("}") + line.count(")")
        depth = max(depth, 0)
    return found


def check_page_directories() -> list[Violation]:
    """页面目录：`PascalCase` + `index.vue`，一个目录一个路由。

    允许**分组目录**（如 `pages/System/`）：它自己没有 index.vue，只装子页面目录
    与共用的 `components/`。分组只是给一批同前缀路由分个家，不代表一条路由。

    ⚠ 目录名写成 kebab-case 或主组件叫 `LoginPage.vue` 都不会报错，
    只会让「路由 → 文件」从机械映射退化成要靠记的事。
    """
    pages = APP / "src" / "pages"
    return _check_page_dir(pages) if pages.is_dir() else []


def _check_page_dir(parent: Path) -> list[Violation]:
    found: list[Violation] = []
    for entry in sorted(parent.iterdir()):
        if entry.name == "components":
            continue
        if not entry.is_dir():
            found.append(
                Violation("pages/ 下只放页面目录", at(entry), entry.name)
            )
            continue
        if not PAGE_DIR.fullmatch(entry.name):
            found.append(
                Violation("页面目录名必须是 PascalCase", at(entry), entry.name)
            )
        if (entry / "index.vue").is_file():
            found.extend(_check_leaf_page(entry))
        else:
            found.extend(_check_page_dir(entry))
    return found


def _check_leaf_page(page: Path) -> list[Violation]:
    return [
        Violation("页面私有组件放本目录的 components/", at(extra), extra.name)
        for extra in sorted(page.glob("*.vue"))
        if extra.name != "index.vue"
    ]


def check_package_names() -> list[Violation]:
    """包名统一 `@dt/<kebab-case>`。"""
    found: list[Violation] = []
    for package in _packages():
        manifest = package / "package.json"
        if not manifest.is_file():
            continue
        name = json.loads(read(manifest)).get("name", "")
        if not re.fullmatch(r"@dt/[a-z][a-z0-9-]*", name):
            found.append(
                Violation("包名必须是 @dt/<kebab-case>", at(manifest), name)
            )
    return found


CHECKS = (
    check_no_tests_beside_sources,
    check_tests_mirror_sources,
    check_packages_do_not_import_app,
    check_no_deep_links,
    check_production_avoids_testing_dir,
    check_barrels_only_reexport,
    check_page_directories,
    check_package_names,
)


if __name__ == "__main__":
    raise SystemExit(main("前端结构检查", CHECKS))
