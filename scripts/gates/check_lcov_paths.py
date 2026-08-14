#!/usr/bin/env python3
"""lcov 路径口径自检闸：testing-standard-typescript.md §4.1 增量覆盖的前提。

⚠ diff-cover 拿 `SF:` 当仓库根相对路径与 git diff 比对；口径对不上时它
不报错，只打一句「No lines with coverage information in this diff」照样
绿灯放行——增量覆盖闸从此空转（#59）。所以先在这里验死：SF 必须能在
仓库根解析到真实文件。

用法：`check_lcov_paths.py <lcov.info>`
"""

from __future__ import annotations

import sys
from pathlib import Path

from _report import ROOT, Violation, main, read

# lcov 报告，一个必填参数
REQUIRED_ARGS = 2
# 违规样例只展示前几条，总数另报
SHOWN = 5


def _sf_paths() -> list[str]:
    report = Path(sys.argv[1])
    return [
        line.removeprefix("SF:").strip()
        for line in read(report).splitlines()
        if line.startswith("SF:")
    ]


def check_report_not_empty() -> list[Violation]:
    """空报告说明覆盖率根本没生成，不是「没有增量」。"""
    if _sf_paths():
        return []
    return [
        Violation(
            "lcov 里没有任何 SF 记录",
            sys.argv[1],
            "覆盖率报告是空的，先查测试是否真跑了",
        )
    ]


def check_sf_paths_resolve_from_repo_root() -> list[Violation]:
    """每条 SF 路径都必须能在仓库根解析到真实文件。"""
    missing = [path for path in _sf_paths() if not (ROOT / path).is_file()]
    if not missing:
        return []
    return [
        Violation(
            "SF 路径无法在仓库根解析",
            sys.argv[1],
            f"{len(missing)} 条，如 {'、'.join(missing[:SHOWN])}；"
            "diff-cover 在仓库根比对，SF 必须写成仓库根相对路径",
        )
    ]


CHECKS = (
    check_report_not_empty,
    check_sf_paths_resolve_from_repo_root,
)


if __name__ == "__main__":
    if len(sys.argv) < REQUIRED_ARGS:
        sys.stderr.write("用法：check_lcov_paths.py <lcov.info>\n")
        raise SystemExit(2)
    raise SystemExit(main("lcov 路径口径检查", CHECKS))
