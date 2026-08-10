#!/usr/bin/env python3
"""前端结构闸：把 project-structure-typescript.md §7 的规则做成红灯。

这些规则违反了不会报错、不会有类型错误，只会在几个月后变成
「没人敢动的公共模块」与「打进产物的测试文件」。
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
PACKAGES = WEB / "packages"
APP = WEB / "app"

TEST_SUFFIX = re.compile(r"\.(test|spec)\.[cm]?[jt]sx?$")
DEEP_LINK = re.compile(r"""from\s+['"]@dt/[a-z-]+/src/""")
APP_IMPORT = re.compile(r"""from\s+['"](@/|.*\bapp/src/)""")
TESTING_IMPORT = re.compile(r"""from\s+['"][^'"]*src/testing""")
TAILWIND_MARKER = re.compile(r"@tailwind\b|@apply\b|'tailwindcss'")
TAILWIND_IMPORT = re.compile(r"""@import\s+['"]tailwindcss['"]""")

SKIP_DIRS = {"node_modules", "dist", "coverage", ".vite"}

STYLE_EXT = {".css", ".scss", ".sass"}
# Tailwind 入口是全仓唯一允许的纯 CSS 文件，理由写在该文件头
TAILWIND_ENTRY = APP / "src" / "styles" / "tailwind.css"


@dataclass
class Violation:
    rule: str
    where: str
    detail: str


def iter_sources(root: Path) -> list[Path]:
    found: list[Path] = []
    if not root.is_dir():
        return found
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if SKIP_DIRS & set(path.parts):
            continue
        if path.suffix in {".ts", ".tsx", ".vue", ".js"}:
            found.append(path)
    return found


def members() -> list[Path]:
    found = [APP] if APP.is_dir() else []
    if PACKAGES.is_dir():
        found.extend(p for p in sorted(PACKAGES.iterdir()) if p.is_dir())
    return found


def check_no_tests_beside_sources() -> list[Violation]:
    """src/ 下不许出现测试文件——测试全部收在成员自己的 tests/ 里。"""
    found: list[Violation] = []
    for member in members():
        for path in iter_sources(member / "src"):
            if TEST_SUFFIX.search(path.name):
                found.append(
                    Violation(
                        "测试不许与源码同目录",
                        str(path.relative_to(ROOT)),
                        "移到本成员的 tests/ 下，目录镜像 src/",
                    )
                )
    return found


def check_tests_mirror_sources() -> list[Violation]:
    """tests/ 下只放测试，别把被测代码也搬进去。"""
    found: list[Violation] = []
    for member in members():
        for path in iter_sources(member / "tests"):
            if not TEST_SUFFIX.search(path.name) and path.name != "setup.ts":
                found.append(
                    Violation(
                        "tests/ 下只放测试文件",
                        str(path.relative_to(ROOT)),
                        "共用夹具放 src/testing/，被测代码放 src/",
                    )
                )
    return found


def check_packages_do_not_import_app() -> list[Violation]:
    """应用壳是终点：被包需要的东西说明它该下沉。"""
    found: list[Violation] = []
    if not PACKAGES.is_dir():
        return found
    for package in sorted(p for p in PACKAGES.iterdir() if p.is_dir()):
        for path in iter_sources(package):
            text = path.read_text(encoding="utf-8")
            if APP_IMPORT.search(text):
                found.append(
                    Violation(
                        "packages/* 不许依赖 app/",
                        str(path.relative_to(ROOT)),
                        "@/ 或 app/src",
                    )
                )
    return found


def check_no_deep_links() -> list[Violation]:
    """深链绕过包的公开面，任何内部重构都会变成破坏性变更。"""
    found: list[Violation] = []
    for member in members():
        for path in iter_sources(member):
            text = path.read_text(encoding="utf-8")
            match = DEEP_LINK.search(text)
            if match:
                found.append(
                    Violation(
                        "不许深链包内部路径",
                        str(path.relative_to(ROOT)),
                        match.group(0),
                    )
                )
    return found


def check_production_avoids_testing_dir() -> list[Violation]:
    """src/testing/ 是测试设施，生产代码引用它会把假件带进产物。"""
    found: list[Violation] = []
    for member in members():
        for path in iter_sources(member / "src"):
            if "testing" in path.parts:
                continue
            if TESTING_IMPORT.search(path.read_text(encoding="utf-8")):
                found.append(
                    Violation(
                        "生产代码不许引用 src/testing",
                        str(path.relative_to(ROOT)),
                        "src/testing",
                    )
                )
    return found


def check_barrels_only_reexport() -> list[Violation]:
    """包的公开出口只做转出。

    ⚠ 只查 `packages/*/src/index.ts`——那是包的公开面。应用壳里的
    `router/index.ts` 之类只是恰好叫这个名字的普通模块，不是桶文件。
    index.ts 已被排除出覆盖率统计，往里塞逻辑等于把代码藏进盲区。
    """
    found: list[Violation] = []
    if not PACKAGES.is_dir():
        return found
    for package in sorted(p for p in PACKAGES.iterdir() if p.is_dir()):
        barrel = package / "src" / "index.ts"
        if not barrel.is_file():
            continue
        found.extend(_non_reexport_statements(barrel))
    return found


def _strip_comments(text: str) -> str:
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"^\s*//.*$", "", text, flags=re.M)


def _non_reexport_statements(path: Path) -> list[Violation]:
    """按语句而非按行判定：多行 export 的续行不算违规。"""
    found: list[Violation] = []
    depth = 0
    for number, raw in enumerate(
        _strip_comments(path.read_text(encoding="utf-8")).splitlines(), start=1
    ):
        line = raw.strip()
        if depth == 0 and line:
            if not line.startswith(("export", "import")):
                found.append(
                    Violation(
                        "桶文件只允许 export 语句",
                        f"{path.relative_to(ROOT)}:{number}",
                        line[:40],
                    )
                )
        depth += line.count("{") + line.count("(")
        depth -= line.count("}") + line.count(")")
        depth = max(depth, 0)
    return found


def check_packages_avoid_tailwind() -> list[Violation]:
    """包不许依赖 Tailwind。

    ⚠ 组件一旦用工具类，挂进没装 Tailwind 的宿主（Storybook、别的应用）
    就只剩裸 DOM，而这在本仓的测试里看不出来。
    """
    found: list[Violation] = []
    if not PACKAGES.is_dir():
        return found
    for package in sorted(p for p in PACKAGES.iterdir() if p.is_dir()):
        for path in iter_sources(package):
            text = path.read_text(encoding="utf-8")
            if TAILWIND_MARKER.search(text):
                found.append(
                    Violation(
                        "packages/* 不许使用 Tailwind",
                        str(path.relative_to(ROOT)),
                        "改用 scoped SCSS + var(--…)",
                    )
                )
        manifest = package / "package.json"
        if manifest.is_file() and "tailwindcss" in manifest.read_text(
            encoding="utf-8"
        ):
            found.append(
                Violation(
                    "packages/* 不许依赖 tailwindcss",
                    str(manifest.relative_to(ROOT)),
                    "tailwindcss",
                )
            )
    return found


def iter_styles(root: Path) -> list[Path]:
    if not root.is_dir():
        return []
    return sorted(
        path
        for path in root.rglob("*")
        if path.is_file()
        and path.suffix in STYLE_EXT
        and not SKIP_DIRS & set(path.parts)
    )


def _style_code(path: Path) -> str:
    """样式表去注释后的正文。注释里引用规则本身不算违规。"""
    return _strip_comments(path.read_text(encoding="utf-8"))


def check_tailwind_entry() -> list[Violation]:
    """Tailwind 入口必须是独立的 .css，且它是唯一允许的纯 CSS 文件。

    ⚠ 这条闸挡的是本仓真踩过的坑：`@import 'tailwindcss'` 一旦写进 .scss，
    Sass 会抢在 @tailwindcss/vite 之前把 node_modules 里那份**静态** CSS 内联掉，
    插件于是看不到入口、一个工具类都不生成——页面全裸，而 build / lint /
    typecheck / 测试**全部照常通过**。样式表其余一律 SCSS。
    """
    found: list[Violation] = []

    if not TAILWIND_ENTRY.is_file():
        found.append(
            Violation(
                "Tailwind 入口必须是 app/src/styles/tailwind.css",
                str(TAILWIND_ENTRY.relative_to(ROOT)),
                "缺失",
            )
        )
    elif not TAILWIND_IMPORT.search(_style_code(TAILWIND_ENTRY)):
        found.append(
            Violation(
                "Tailwind 入口里必须有 @import 'tailwindcss'",
                str(TAILWIND_ENTRY.relative_to(ROOT)),
                "没找到入口语句",
            )
        )

    for member in members():
        for path in iter_styles(member):
            if path == TAILWIND_ENTRY:
                continue
            if path.suffix == ".css":
                found.append(
                    Violation(
                        "样式表只能是 .scss / .sass",
                        str(path.relative_to(ROOT)),
                        "唯一例外是 Tailwind 入口",
                    )
                )
            elif TAILWIND_IMPORT.search(_style_code(path)):
                found.append(
                    Violation(
                        "Sass 里不许导入 tailwindcss",
                        str(path.relative_to(ROOT)),
                        "会被 Sass 内联掉，工具类一个都不生成",
                    )
                )

    found.extend(_check_style_entry_order())
    return found


def _check_style_entry_order() -> list[Violation]:
    """tailwind.css 必须先于 index.scss 引入。

    ⚠ 级联层的先后由**首次出现**的顺序定。tailwind.css 里那句
    `@layer theme, base, components, utilities` 要是排在全局样式之后，
    工具类就压不过 base / components 层里的规则了。
    """
    entry = APP / "src" / "main.ts"
    if not entry.is_file():
        return []
    text = entry.read_text(encoding="utf-8")
    tailwind = text.find("styles/tailwind.css")
    sass = text.find("styles/index.scss")
    if tailwind == -1 or sass == -1 or tailwind < sass:
        return []
    return [
        Violation(
            "main.ts 必须先 import tailwind.css 再 import index.scss",
            str(entry.relative_to(ROOT)),
            "顺序决定级联层先后",
        )
    ]


def check_pages_have_no_raw_table() -> list[Violation]:
    """页面里不许手写 `<table>`，列表一律走 DtDataView。

    ⚠ 手写表格必然各写各的：列宽、表头字号、行分隔、hover、sticky、空态会在
    每张表上长出一个样子，而这种参差要把两页并排才看得出来。
    """
    found: list[Violation] = []
    for path in iter_sources(APP / "src"):
        if path.suffix != ".vue":
            continue
        if "<table" in path.read_text(encoding="utf-8"):
            found.append(
                Violation(
                    "页面不许手写 <table>",
                    str(path.relative_to(ROOT)),
                    "改用 @dt/ui 的 DtDataView / DtTable",
                )
            )
    return found


# 收窄整页的写法：AppShell 的宽度开关，或页面根上的 max-w-
PAGE_WIDTH = re.compile(r"content-width|contentWidth")
NATIVE_DIALOG = re.compile(r"\bwindow\.(confirm|alert)\s*\(")


def check_pages_fill_width() -> list[Violation]:
    """页面铺满可用宽度，且不用浏览器原生确认框。

    ⚠ 一半页面限宽、一半铺满时，切换导航整块内容会左右跳，而单看某一页
    完全看不出来。原生 confirm 同理：它塞不下「会发生什么、能不能撤销」。
    """
    found: list[Violation] = []
    for path in iter_sources(APP / "src"):
        text = path.read_text(encoding="utf-8")
        if PAGE_WIDTH.search(text):
            found.append(
                Violation(
                    "页面不许收窄整页宽度",
                    str(path.relative_to(ROOT)),
                    "去掉 content-width，行宽在页面自己的栅格里控制",
                )
            )
        if NATIVE_DIALOG.search(text):
            found.append(
                Violation(
                    "不许用原生 confirm / alert",
                    str(path.relative_to(ROOT)),
                    "改用 useConfirm().ask() / useToast()",
                )
            )
    return found


def check_pages_own_their_height() -> list[Violation]:
    """套了 AppShell 的页面必须自己吃满高度。

    ⚠ AppShell 的 `<main>` 是 `overflow-hidden`，滚动交给页面里的 DtDataView。
    页面根节点不写 `h-full … min-h-0` 的话，表格拿不到有界高度 → 不滚动而是
    一路撑长 → 超出的部分被 main 裁掉，**页面上任何位置都没有滚动条**。
    """
    found: list[Violation] = []
    pages = APP / "src" / "pages"
    for path in iter_sources(pages):
        if path.name != "index.vue":
            continue
        text = path.read_text(encoding="utf-8")
        if "<AppShell" not in text:
            continue
        if "h-full" not in text or "min-h-0" not in text:
            found.append(
                Violation(
                    "页面根节点必须 h-full + min-h-0",
                    str(path.relative_to(ROOT)),
                    "main 不滚了，高度由页面自己吃满",
                )
            )
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
                Violation(
                    "pages/ 下只放页面目录",
                    str(entry.relative_to(ROOT)),
                    entry.name,
                )
            )
            continue
        if not re.fullmatch(r"[A-Z][A-Za-z0-9]*", entry.name):
            found.append(
                Violation(
                    "页面目录名必须是 PascalCase",
                    str(entry.relative_to(ROOT)),
                    entry.name,
                )
            )
        if (entry / "index.vue").is_file():
            found.extend(_check_leaf_page(entry))
        else:
            found.extend(_check_page_dir(entry))
    return found


def _check_leaf_page(page: Path) -> list[Violation]:
    return [
        Violation(
            "页面私有组件放本目录的 components/",
            str(extra.relative_to(ROOT)),
            extra.name,
        )
        for extra in sorted(page.glob("*.vue"))
        if extra.name != "index.vue"
    ]


def check_package_names() -> list[Violation]:
    """包名统一 `@dt/<kebab-case>`。"""
    found: list[Violation] = []
    if not PACKAGES.is_dir():
        return found
    for package in sorted(p for p in PACKAGES.iterdir() if p.is_dir()):
        manifest = package / "package.json"
        if not manifest.is_file():
            continue
        name = json.loads(manifest.read_text(encoding="utf-8")).get("name", "")
        if not re.fullmatch(r"@dt/[a-z][a-z0-9-]*", name):
            found.append(
                Violation(
                    "包名必须是 @dt/<kebab-case>",
                    str(manifest.relative_to(ROOT)),
                    name,
                )
            )
    return found


CHECKS = (
    check_no_tests_beside_sources,
    check_tests_mirror_sources,
    check_packages_do_not_import_app,
    check_no_deep_links,
    check_production_avoids_testing_dir,
    check_barrels_only_reexport,
    check_packages_avoid_tailwind,
    check_tailwind_entry,
    check_pages_have_no_raw_table,
    check_pages_fill_width,
    check_pages_own_their_height,
    check_page_directories,
    check_package_names,
)


def main() -> int:
    """跑全部检查；有违规就逐条打印并以非零码退出。"""
    violations: list[Violation] = []
    for check in CHECKS:
        violations.extend(check())
    if not violations:
        sys.stdout.write(f"前端结构检查通过（{len(CHECKS)} 项）\n")
        return 0
    for item in violations:
        sys.stderr.write(f"[{item.rule}] {item.where} → {item.detail}\n")
    sys.stderr.write(f"\n共 {len(violations)} 处违规\n")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
