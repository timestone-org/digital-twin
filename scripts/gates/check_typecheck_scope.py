#!/usr/bin/env python3
"""类型闸的自检：pyright 到底看了几个文件。

⚠ 这条闸挡的是本仓真踩过的坑：`include = ["services/*/src"]` 里的单个 `*`
匹配不到 `services/<svc>/src` 这一层，于是**一个服务文件都没被检查**，
而 pyright 的输出仍然是「0 errors」——比没有类型检查更糟，因为它看起来是绿的。

用法：`check_typecheck_scope.py <pyright --outputjson 的输出文件>`
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import cast

from _report import PY, SERVER, Violation, iter_files, main, read

REQUIRED_ARGS = 2
# 被 include 覆盖的目录，与 server/pyproject.toml 的 [tool.pyright] include 对应
SCOPES = (
    "lib/src",
    "domain/*/src",
    "services/*/src",
    "services/*/scripts",
)
EXCLUDED = ("migrations",)


def _expected() -> list[Path]:
    found: list[Path] = []
    for scope in SCOPES:
        for root in sorted(SERVER.glob(scope)):
            found.extend(
                path
                for path in iter_files(root, PY)
                if not set(EXCLUDED) & set(path.parts)
            )
    return found


def _analysed() -> int:
    report = cast("dict[str, object]", json.loads(read(Path(sys.argv[1]))))
    summary = report.get("summary")
    if not isinstance(summary, dict):
        return 0
    count = cast("dict[str, object]", summary).get("filesAnalyzed")
    return count if isinstance(count, int) else 0


def check_scope_covers_every_source() -> list[Violation]:
    """pyright 分析过的文件数必须覆盖 include 下的全部源码。"""
    expected = _expected()
    analysed = _analysed()
    sys.stdout.write(
        f"pyright 分析了 {analysed} 个文件，源码 {len(expected)} 个\n"
    )
    if analysed >= len(expected):
        return []
    return [
        Violation(
            "类型检查覆盖不到全部源码",
            "server/pyproject.toml [tool.pyright] include",
            f"只看了 {analysed} 个，少于源码的 {len(expected)} 个"
            "；pyright 的单个 * 匹配不到目录层，要写 **",
        )
    ]


CHECKS = (check_scope_covers_every_source,)


if __name__ == "__main__":
    if len(sys.argv) < REQUIRED_ARGS:
        sys.stderr.write("用法：check_typecheck_scope.py <pyright.json>\n")
        raise SystemExit(2)
    raise SystemExit(main("类型检查范围自检", CHECKS))
