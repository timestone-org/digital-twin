#!/usr/bin/env python3
"""把 pyright 的原始输出切成 JSON、逐条打印错误、有错即红。

⚠ 不能直接把 pyright 的 stdout 当 JSON 喂给 jq：它的 Python 包装器会先往
**stdout** 打两行——装 node 的进度、以及一行 Python 字典 repr（同样以 `{`
开头）。第一行就 parse error，而那与「类型检查真的失败了」长得完全不一样。

用法：`check_pyright.py <pyright --outputjson 的原始输出> <要写出的 json>`
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import cast

from _report import Violation, main, read

REQUIRED_ARGS = 3
MAX_SHOWN = 50


def _extract() -> dict[str, object]:
    """从原始输出里截出 JSON 正文并写到目标路径。

    只认**独占一行**的 `{`：包装器打的那行字典 repr 也以 `{` 开头，
    按「行首是 {」截会截到它上面去。
    """
    raw = read(Path(sys.argv[1])).splitlines()
    for index, line in enumerate(raw):
        if line.rstrip() == "{":
            body = "\n".join(raw[index:])
            Path(sys.argv[2]).write_text(body, encoding="utf-8")
            return cast("dict[str, object]", json.loads(body))
    sys.stderr.write("pyright 没有产出 JSON，原始输出：\n")
    sys.stderr.write("\n".join(raw[:20]) + "\n")
    raise SystemExit(1)


def _diagnostics(report: dict[str, object]) -> list[dict[str, object]]:
    raw = report.get("generalDiagnostics")
    if not isinstance(raw, list):
        return []
    items = cast("list[object]", raw)
    return [
        cast("dict[str, object]", item)
        for item in items
        if isinstance(item, dict)
    ]


def _where(item: dict[str, object]) -> str:
    span = item.get("range")
    line = 0
    if isinstance(span, dict):
        start = cast("dict[str, object]", span).get("start")
        if isinstance(start, dict):
            raw = cast("dict[str, object]", start).get("line")
            line = raw + 1 if isinstance(raw, int) else 0
    return f"{item.get('file')}:{line}"


def check_no_type_errors() -> list[Violation]:
    """pyright strict 零错误。"""
    report = _extract()
    errors = [
        item for item in _diagnostics(report) if item.get("severity") == "error"
    ]
    for item in errors[:MAX_SHOWN]:
        sys.stderr.write(
            f"  {_where(item)} {item.get('rule')}: {item.get('message')}\n"
        )
    if not errors:
        return []
    return [
        Violation("类型检查有错误", "pyright", f"{len(errors)} 处，见上面逐条")
    ]


CHECKS = (check_no_type_errors,)


if __name__ == "__main__":
    if len(sys.argv) < REQUIRED_ARGS:
        sys.stderr.write("用法：check_pyright.py <原始输出> <目标 json>\n")
        raise SystemExit(2)
    raise SystemExit(main("类型检查", CHECKS))
