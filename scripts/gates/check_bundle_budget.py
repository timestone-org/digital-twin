#!/usr/bin/env python3
"""首屏包体闸：testing-standard-typescript.md §8。

⚠ 没有闸门，包体只会单调增长——它是那种每次只多几 KB、半年后翻倍的指标。
读的是 `pnpm build` 的真实产物，因此必须排在 build 之后跑。
"""

from __future__ import annotations

import gzip
import re
import sys
from pathlib import Path

from _report import ROOT, Violation, at, main, read

DIST = ROOT / "web" / "app" / "dist"
INDEX = DIST / "index.html"

MAX_JS_GZIP_KB = 300
MAX_CSS_GZIP_KB = 100
# 重依赖必须异步加载，不许出现在首屏 chunk 里
HEAVY = ("three", "echarts", "monaco", "@babel", "moment")

ENTRY = re.compile(r"""<script[^>]+src=["'](?P<href>[^"']+)["']""")
PRELOAD = re.compile(
    r"""<link[^>]+rel=["']modulepreload["'][^>]+href=["'](?P<href>[^"']+)["']"""
)
STYLESHEET = re.compile(
    r"""<link[^>]+rel=["']stylesheet["'][^>]+href=["'](?P<href>[^"']+)["']"""
)


def _asset(href: str) -> Path:
    return DIST / href.lstrip("/")


def _first_screen() -> tuple[list[Path], list[Path]]:
    """首屏真正会被下载的两组产物：入口与预载的 JS、以及样式表。"""
    if not INDEX.is_file():
        return [], []
    text = read(INDEX)
    scripts = [
        _asset(match.group("href"))
        for pattern in (ENTRY, PRELOAD)
        for match in pattern.finditer(text)
    ]
    styles = [
        _asset(match.group("href")) for match in STYLESHEET.finditer(text)
    ]
    return [path for path in scripts if path.is_file()], [
        path for path in styles if path.is_file()
    ]


def _gzip_kb(paths: list[Path]) -> float:
    total = sum(len(gzip.compress(path.read_bytes())) for path in paths)
    return round(total / 1024, 1)


def check_dist_exists() -> list[Violation]:
    """没有产物就没法断言体积——这条闸必须排在 build 之后。"""
    if INDEX.is_file():
        return []
    return [
        Violation(
            "缺少构建产物",
            at(DIST),
            "先跑 pnpm build，再跑本闸",
        )
    ]


def check_first_screen_budget() -> list[Violation]:
    """首屏 JS 与 CSS 各有 gzip 上限，超限即失败。"""
    scripts, styles = _first_screen()
    if not scripts:
        return []
    found: list[Violation] = []
    budgets = (
        ("JS", _gzip_kb(scripts), MAX_JS_GZIP_KB),
        ("CSS", _gzip_kb(styles), MAX_CSS_GZIP_KB),
    )
    for kind, actual, limit in budgets:
        if actual > limit:
            found.append(
                Violation(
                    f"首屏 {kind} 超出预算",
                    at(DIST),
                    f"{actual} KB gzip > {limit} KB",
                )
            )
    return found


def check_heavy_deps_are_lazy() -> list[Violation]:
    """重依赖（3D、图表、编辑器）必须异步加载。"""
    scripts, _ = _first_screen()
    return [
        Violation(
            "重依赖不许进首屏 chunk", at(path), f"{name}；改成动态 import"
        )
        for path in scripts
        for name in HEAVY
        if _mentions(path, name)
    ]


def _mentions(path: Path, name: str) -> bool:
    text = path.read_text(encoding="utf-8", errors="ignore")
    return f'"{name}' in text or f"from'{name}" in text


def report_budget() -> list[Violation]:
    """把当前占用打出来，让每次 PR 都能看见它在往哪个方向走。"""
    scripts, styles = _first_screen()
    if scripts:
        sys.stdout.write(
            f"首屏 JS {_gzip_kb(scripts)} KB / {MAX_JS_GZIP_KB} KB，"
            f"CSS {_gzip_kb(styles)} KB / {MAX_CSS_GZIP_KB} KB（gzip）\n"
        )
    return []


CHECKS = (
    check_dist_exists,
    check_first_screen_budget,
    check_heavy_deps_are_lazy,
    report_budget,
)


if __name__ == "__main__":
    raise SystemExit(main("首屏包体检查", CHECKS))
