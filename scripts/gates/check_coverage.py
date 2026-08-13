#!/usr/bin/env python3
"""覆盖率棘轮闸：testing-standard-python.md §4.2 与 TS 侧同款口径。

整体覆盖率**不允许下降**，哪怕仍在阈值之上——这条防的是「大量新代码
稀释旧的高覆盖」。基线在比对时按 CEILING 封顶：覆盖一度冲到 99% 不会
把之后每个 PR 的门槛也锁死在 99%。阈值本身写在各自的 pyproject /
vitest.config 里，这里只管「不许比封顶后的基线低」。

用法：
    check_coverage.py <名字> <coverage.xml|lcov.info> [--update]
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from xml.etree import ElementTree

from _report import Violation, main, read

BASELINE = Path(__file__).resolve().parent / "coverage-baseline.json"
# 名字 + 报告文件，两个必填参数
REQUIRED_ARGS = 3
# 浮点抖动与用例顺序会带来极小的波动，低于这个幅度不算下降
TOLERANCE = 0.1
# 棘轮封顶：防稀释守的是水位线，不是历史最高点
CEILING = {"lines": 90.0, "branches": 80.0}

LCOV_LINES_FOUND = re.compile(r"^LF:(?P<count>\d+)$", re.MULTILINE)
LCOV_LINES_HIT = re.compile(r"^LH:(?P<count>\d+)$", re.MULTILINE)
LCOV_BRANCHES_FOUND = re.compile(r"^BRF:(?P<count>\d+)$", re.MULTILINE)
LCOV_BRANCHES_HIT = re.compile(r"^BRH:(?P<count>\d+)$", re.MULTILINE)


def _percent(hit: int, found: int) -> float:
    return round(hit * 100 / found, 2) if found else 100.0


def _from_cobertura(path: Path) -> dict[str, float]:
    root = ElementTree.parse(path).getroot()
    return {
        "lines": round(float(root.get("line-rate", "0")) * 100, 2),
        "branches": round(float(root.get("branch-rate", "0")) * 100, 2),
    }


def _sum(pattern: re.Pattern[str], text: str) -> int:
    return sum(int(match.group("count")) for match in pattern.finditer(text))


def _from_lcov(path: Path) -> dict[str, float]:
    text = read(path)
    return {
        "lines": _percent(
            _sum(LCOV_LINES_HIT, text), _sum(LCOV_LINES_FOUND, text)
        ),
        "branches": _percent(
            _sum(LCOV_BRANCHES_HIT, text), _sum(LCOV_BRANCHES_FOUND, text)
        ),
    }


def _measure(path: Path) -> dict[str, float]:
    if path.suffix == ".xml":
        return _from_cobertura(path)
    return _from_lcov(path)


def _baseline() -> dict[str, dict[str, float]]:
    if not BASELINE.is_file():
        return {}
    loaded: dict[str, dict[str, float]] = json.loads(read(BASELINE))
    return loaded


def _write(name: str, current: dict[str, float]) -> None:
    data = _baseline()
    data[name] = current
    BASELINE.write_text(
        json.dumps(dict(sorted(data.items())), indent=2, ensure_ascii=False)
        + "\n",
        encoding="utf-8",
    )


def run() -> int:
    """比对当前覆盖率与基线；`--update` 时把基线抬到当前水位。"""
    if len(sys.argv) < REQUIRED_ARGS:
        sys.stderr.write(
            "用法：check_coverage.py <名字> <报告文件> [--update]\n"
        )
        return 2
    name, report = sys.argv[1], Path(sys.argv[2])
    if not report.is_file():
        sys.stderr.write(f"找不到覆盖率报告：{report}\n")
        return 2
    current = _measure(report)
    if "--update" in sys.argv:
        _write(name, current)
        sys.stdout.write(f"{name} 基线已更新为 {current}\n")
        return 0
    return main(f"{name} 覆盖率棘轮", (lambda: _compare(name, current),))


def _compare(name: str, current: dict[str, float]) -> list[Violation]:
    recorded = _baseline().get(name)
    sys.stdout.write(
        f"{name}：行 {current['lines']}%、分支 {current['branches']}%"
        f"（基线 {recorded or '未记录'}）\n"
    )
    if recorded is None:
        return [
            Violation(
                "覆盖率基线未记录",
                name,
                "跑一次 check_coverage.py <名字> <报告> --update 并提交基线",
            )
        ]
    floors = {
        kind: min(recorded[kind], CEILING[kind])
        for kind in ("lines", "branches")
    }
    return [
        Violation(
            "覆盖率不许低于基线（封顶后）",
            name,
            f"{kind} {current[kind]}% < {floors[kind]}%",
        )
        for kind in ("lines", "branches")
        if current[kind] + TOLERANCE < floors[kind]
    ]


if __name__ == "__main__":
    raise SystemExit(run())
