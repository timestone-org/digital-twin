#!/usr/bin/env python3
"""前端样式与页面布局闸：project-structure-typescript.md §4.2、§4.3、§7。

这一组守的全是「闸门照常通过、只有肉眼能发现」的坑：Sass 抢先内联掉
Tailwind 入口、不分层的全局样式静默压掉工具类、页面根节点漏了 `min-h-0`
于是整页任何位置都没有滚动条。
"""

from __future__ import annotations

import re
from pathlib import Path

from _report import (
    ROOT,
    STYLE,
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
# Tailwind 入口是全仓唯一允许的纯 CSS 文件，理由写在该文件头
TAILWIND_ENTRY = APP / "src" / "styles" / "tailwind.css"

TAILWIND_MARKER = re.compile(r"@tailwind\b|@apply\b|'tailwindcss'")
TAILWIND_IMPORT = re.compile(r"""@import\s+['"]tailwindcss['"]""")
# 收窄整页的写法：AppShell 的宽度开关，或页面根上的 max-w-
PAGE_WIDTH = re.compile(r"content-width|contentWidth")
NATIVE_DIALOG = re.compile(r"\bwindow\.(confirm|alert)\s*\(")


def _sources(root: Path) -> list[Path]:
    return list(iter_files(root, TS | frozenset({".js"})))


def _packages() -> list[Path]:
    if not PACKAGES.is_dir():
        return []
    return sorted(path for path in PACKAGES.iterdir() if path.is_dir())


def check_packages_avoid_tailwind() -> list[Violation]:
    """包不许依赖 Tailwind。

    ⚠ 组件一旦用工具类，挂进没装 Tailwind 的宿主（Storybook、别的应用）
    就只剩裸 DOM，而这在本仓的测试里看不出来。
    """
    found: list[Violation] = []
    for package in _packages():
        found.extend(
            Violation(
                "packages/* 不许使用 Tailwind",
                at(path),
                "改用 scoped SCSS + var(--…)",
            )
            for path in _sources(package)
            if TAILWIND_MARKER.search(read(path))
        )
        manifest = package / "package.json"
        if manifest.is_file() and "tailwindcss" in read(manifest):
            found.append(
                Violation(
                    "packages/* 不许依赖 tailwindcss",
                    at(manifest),
                    "tailwindcss",
                )
            )
    return found


def _style_code(path: Path) -> str:
    """样式表去注释后的正文。注释里引用规则本身不算违规。

    Args: path。
    """
    return strip_ts_comments(read(path))


def check_tailwind_entry() -> list[Violation]:
    """Tailwind 入口必须是独立的 .css，且它是唯一允许的纯 CSS 文件。

    ⚠ 这条闸挡的是本仓真踩过的坑：`@import 'tailwindcss'` 一旦写进 .scss，
    Sass 会抢在 @tailwindcss/vite 之前把 node_modules 里那份**静态** CSS 内联，
    插件于是看不到入口、一个工具类都不生成——页面全裸，而 build / lint /
    typecheck / 测试**全部照常通过**。样式表其余一律 SCSS。
    """
    found = _entry_exists()
    for member in web_members():
        for path in iter_files(member / "src", STYLE):
            if path == TAILWIND_ENTRY:
                continue
            if path.suffix == ".css":
                found.append(
                    Violation(
                        "样式表只能是 .scss / .sass",
                        at(path),
                        "唯一例外是 Tailwind 入口",
                    )
                )
            elif TAILWIND_IMPORT.search(_style_code(path)):
                found.append(
                    Violation(
                        "Sass 里不许导入 tailwindcss",
                        at(path),
                        "会被 Sass 内联掉，工具类一个都不生成",
                    )
                )
    found.extend(_check_style_entry_order())
    return found


def _entry_exists() -> list[Violation]:
    if not TAILWIND_ENTRY.is_file():
        return [
            Violation(
                "Tailwind 入口必须是 app/src/styles/tailwind.css",
                at(TAILWIND_ENTRY),
                "缺失",
            )
        ]
    if not TAILWIND_IMPORT.search(_style_code(TAILWIND_ENTRY)):
        return [
            Violation(
                "Tailwind 入口里必须有 @import 'tailwindcss'",
                at(TAILWIND_ENTRY),
                "没找到入口语句",
            )
        ]
    return []


def _check_style_entry_order() -> list[Violation]:
    """tailwind.css 必须先于 index.scss 引入。

    ⚠ 级联层的先后由**首次出现**的顺序定。tailwind.css 里那句
    `@layer theme, base, components, utilities` 要是排在全局样式之后，
    工具类就压不过 base / components 层里的规则了。
    """
    entry = APP / "src" / "main.ts"
    if not entry.is_file():
        return []
    text = read(entry)
    tailwind = text.find("styles/tailwind.css")
    sass = text.find("styles/index.scss")
    if tailwind == -1 or sass == -1 or tailwind < sass:
        return []
    return [
        Violation(
            "main.ts 必须先 import tailwind.css 再 import index.scss",
            at(entry),
            "顺序决定级联层先后",
        )
    ]


def check_pages_have_no_raw_table() -> list[Violation]:
    """页面里不许手写 `<table>`，列表一律走 DtDataView。

    ⚠ 手写表格必然各写各的：列宽、表头字号、行分隔、hover、sticky、空态会在
    每张表上长出一个样子，而这种参差要把两页并排才看得出来。
    """
    return [
        Violation(
            "页面不许手写 <table>",
            at(path),
            "改用 @dt/ui 的 DtDataView / DtTable",
        )
        for path in _sources(APP / "src")
        if path.suffix == ".vue" and "<table" in read(path)
    ]


def check_pages_fill_width() -> list[Violation]:
    """页面铺满可用宽度，且不用浏览器原生确认框。

    ⚠ 一半页面限宽、一半铺满时，切换导航整块内容会左右跳，而单看某一页
    完全看不出来。原生 confirm 同理：它塞不下「会发生什么、能不能撤销」。
    """
    found: list[Violation] = []
    for path in _sources(APP / "src"):
        text = read(path)
        if PAGE_WIDTH.search(text):
            found.append(
                Violation(
                    "页面不许收窄整页宽度",
                    at(path),
                    "去掉 content-width，行宽在页面自己的栅格里控制",
                )
            )
        if NATIVE_DIALOG.search(text):
            found.append(
                Violation(
                    "不许用原生 confirm / alert",
                    at(path),
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
    for path in _sources(APP / "src" / "pages"):
        if path.name != "index.vue":
            continue
        text = read(path)
        if "<AppShell" not in text:
            continue
        if "h-full" not in text or "min-h-0" not in text:
            found.append(
                Violation(
                    "页面根节点必须 h-full + min-h-0",
                    at(path),
                    "main 不滚了，高度由页面自己吃满",
                )
            )
    return found


CHECKS = (
    check_packages_avoid_tailwind,
    check_tailwind_entry,
    check_pages_have_no_raw_table,
    check_pages_fill_width,
    check_pages_own_their_height,
)


if __name__ == "__main__":
    raise SystemExit(main("前端样式与布局检查", CHECKS))
