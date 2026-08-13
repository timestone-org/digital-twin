#!/usr/bin/env python3
"""Python 规模与压制指令闸：code-style-python.md §3、§4、§2.2。

规模超限不是「写得不好」，是代码在说它承担了多件事；而裸 `type: ignore`
与无理由的函数内 import 会让静态检查在那一处静默失效。
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

from _report import (
    PY,
    FuncDef,
    Violation,
    at,
    functions,
    iter_files,
    main,
    parse,
    python_comments,
    python_sources,
    python_test_roots,
    read,
)

MAX_FUNCTION_LINES = 50
MAX_ROUTE_LINES = 20  # 超了几乎一定是业务漏进了 HTTP 层
MAX_NESTING = 4
MAX_CLASS_LINES = 300
MAX_MODULE_LINES = 600

HTTP_METHODS = frozenset(
    {"get", "post", "put", "patch", "delete", "head", "options", "websocket"}
)
NESTED = (
    ast.If,
    ast.For,
    ast.AsyncFor,
    ast.While,
    ast.With,
    ast.AsyncWith,
    ast.Try,
    ast.Match,
)

# 允许函数内 import 的唯一理由是启动开销，且必须写在同行或上一行
LAZY_REASON = re.compile(r"启动开销|加载成本|lazy|重依赖")
# 带具体错误码且带理由的压制才算显式：`# type: ignore[arg-type]  # 理由`
TYPE_IGNORE = re.compile(r"#\s*type:\s*ignore(?P<code>\[[^\]]+\])?(?P<rest>.*)")
NOQA = re.compile(r"#\s*noqa(?P<code>:\s*[A-Z]+[0-9]+)?(?P<rest>.*)")
PRAGMA = re.compile(r"#\s*pragma:\s*no cover(?P<rest>.*)")


def _all_python() -> list[Path]:
    """生产代码、脚本与测试——规模上限对三者一视同仁。"""
    found = list(python_sources())
    for root in python_test_roots():
        found.extend(iter_files(root, PY))
    return found


def _is_route(node: FuncDef) -> bool:
    """带 `@router.get(...)` 这类装饰器的即路由函数。

    Args: node。
    """
    for decorator in node.decorator_list:
        call = decorator.func if isinstance(decorator, ast.Call) else decorator
        if isinstance(call, ast.Attribute) and call.attr in HTTP_METHODS:
            return True
    return False


def _span(node: ast.AST) -> int:
    start = getattr(node, "lineno", 0)
    end = getattr(node, "end_lineno", None) or start
    return int(end) - int(start) + 1


def check_function_length() -> list[Violation]:
    """函数 ≤50 行，路由函数 ≤20 行。"""
    found: list[Violation] = []
    for path in _all_python():
        tree = parse(path)
        if tree is None:
            continue
        for node in functions(tree):
            limit = MAX_ROUTE_LINES if _is_route(node) else MAX_FUNCTION_LINES
            length = _span(node)
            if length > limit:
                found.append(
                    Violation(
                        f"函数不许超过 {limit} 行",
                        at(path, node.lineno),
                        f"{node.name} 有 {length} 行",
                    )
                )
    return found


def _depth(node: ast.AST, current: int = 0) -> int:
    """算一段代码里的最大嵌套层数。

    Args: node, current。
    """
    deepest = current
    for child in ast.iter_child_nodes(node):
        if isinstance(child, ast.FunctionDef | ast.AsyncFunctionDef):
            continue
        step = 1 if isinstance(child, NESTED) else 0
        deepest = max(deepest, _depth(child, current + step))
    return deepest


def check_nesting_depth() -> list[Violation]:
    """嵌套 ≤4 层，超了用卫语句提前返回。"""
    found: list[Violation] = []
    for path in _all_python():
        tree = parse(path)
        if tree is None:
            continue
        for node in functions(tree):
            depth = _depth(node)
            if depth > MAX_NESTING:
                found.append(
                    Violation(
                        f"嵌套不许超过 {MAX_NESTING} 层",
                        at(path, node.lineno),
                        f"{node.name} 嵌套 {depth} 层",
                    )
                )
    return found


def check_class_and_module_length() -> list[Violation]:
    """类 ≤300 行、模块 ≤600 行。"""
    found: list[Violation] = []
    for path in _all_python():
        text = read(path)
        lines = len(text.splitlines())
        if lines > MAX_MODULE_LINES:
            found.append(
                Violation(
                    f"模块不许超过 {MAX_MODULE_LINES} 行",
                    at(path),
                    f"{lines} 行，该拆模块",
                )
            )
        tree = parse(path)
        if tree is None:
            continue
        found.extend(
            Violation(
                f"类不许超过 {MAX_CLASS_LINES} 行",
                at(path, node.lineno),
                f"{node.name} 有 {_span(node)} 行",
            )
            for node in ast.walk(tree)
            if isinstance(node, ast.ClassDef) and _span(node) > MAX_CLASS_LINES
        )
    return found


def check_no_function_level_import() -> list[Violation]:
    """函数内 import 不解决循环依赖，只是把编译期的环藏到运行期。

    ⚠ 唯一允许的理由是启动开销，且必须在同行或上一行写明。
    """
    found: list[Violation] = []
    for path in _all_python():
        tree = parse(path)
        if tree is None:
            continue
        lines = read(path).splitlines()
        for node in functions(tree):
            found.extend(_lazy_imports(path, node, lines))
    return found


def _lazy_imports(
    path: Path, node: FuncDef, lines: list[str]
) -> list[Violation]:
    found: list[Violation] = []
    for child in ast.walk(node):
        if not isinstance(child, ast.Import | ast.ImportFrom):
            continue
        window = "".join(lines[max(child.lineno - 2, 0) : child.lineno])
        if LAZY_REASON.search(window):
            continue
        found.append(
            Violation(
                "禁止在函数内 import",
                at(path, child.lineno),
                f"{node.name} 内的 import；环要靠下沉公共部分解，不靠惰性藏",
            )
        )
    return found


def check_suppressions_have_reasons() -> list[Violation]:
    """`type: ignore` 要带错误码与理由，`noqa` 与 `pragma` 要带理由。

    理由写在同一行或上一行都算——上一行是长理由的常规写法。
    """
    found: list[Violation] = []
    for path in _all_python():
        lines = read(path).splitlines()
        for number, line in python_comments(path):
            above = lines[number - 2] if number > 1 else ""
            if above.strip().startswith("#") and "理由" in above:
                continue
            found.extend(_suppression(path, number, line))
    return found


def _suppression(path: Path, number: int, line: str) -> list[Violation]:
    ignore = TYPE_IGNORE.search(line)
    if ignore is not None:
        if not ignore.group("code"):
            return [
                Violation(
                    "裸 type: ignore 一律打回",
                    at(path, number),
                    "写成 # type: ignore[错误码]  # 理由",
                )
            ]
        if not ignore.group("rest").strip().lstrip("#").strip():
            return [
                Violation(
                    "type: ignore 必须写理由",
                    at(path, number),
                    line.strip()[:60],
                )
            ]
    return [*_noqa(path, number, line), *_pragma(path, number, line)]


def _noqa(path: Path, number: int, line: str) -> list[Violation]:
    match = NOQA.search(line)
    if match is None or match.group("code"):
        return []
    return [
        Violation(
            "裸 noqa 一律打回",
            at(path, number),
            "写成 # noqa: 规则码",
        )
    ]


def _pragma(path: Path, number: int, line: str) -> list[Violation]:
    match = PRAGMA.search(line)
    if match is None or match.group("rest").strip().lstrip("#").strip():
        return []
    return [
        Violation(
            "pragma: no cover 必须写理由",
            at(path, number),
            line.strip()[:60],
        )
    ]


CHECKS = (
    check_function_length,
    check_nesting_depth,
    check_class_and_module_length,
    check_no_function_level_import,
    check_suppressions_have_reasons,
)


if __name__ == "__main__":
    raise SystemExit(main("Python 规模与压制指令检查", CHECKS))
