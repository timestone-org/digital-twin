#!/usr/bin/env python3
"""Python 命名闸：code-style-python.md §1。

同一个概念在全仓只能有一个名字，而缩写、单字母与丢了单位的量名
正是它长出第二个名字的入口——读代码的人会以为它们是两种东西。
"""

from __future__ import annotations

import ast
import re
from collections.abc import Iterator
from pathlib import Path

from _report import (
    PY,
    Violation,
    at,
    iter_files,
    main,
    parse,
    python_sources,
    python_test_roots,
)

BOOL_PREFIX = ("is_", "has_", "should_", "can_", "allow_", "use_", "require_")
BOOL_SUFFIX = ("_enabled", "_disabled", "_available", "_required")

# 带时间语义的量必须把单位写进名字：`TIMEOUT=30` 是秒还是毫秒？
TIMED = re.compile(
    r"(?:^|_)(timeout|interval|ttl|delay|duration|period|deadline"
    r"|elapsed|lifetime|expiry|backoff|latency|grace)(?:_|$)"
)
UNIT_SUFFIX = re.compile(r"_(s|ms|us|ns|min|minutes|h|d|days|hours|seconds)$")

# 领域内公认的缩写之外一律写全：读的人不该去猜 svc 是 service 还是 survey
ABBREVIATIONS = frozenset(
    {
        "cfg",
        "conf",
        "mgr",
        "svc",
        "res",
        "resp",
        "req",
        "val",
        "obj",
        "arr",
        "num",
        "tmp",
        "temp",
        "idx",
        "ctx",
        "btn",
        "el",
        "elem",
        "err",
        "impl",
        "calc",
        "proc",
        "attr",
        "pos",
        "cnt",
        "usr",
        "pwd",
    }
)
# 类型标注已经说了它是什么，名字里不必再说一遍。
# ⚠ 不收 `_set`：审计动作名里的 `_SET` 是动词「设置」，不是集合类型。
TYPE_IN_NAME = re.compile(r"_(list|dict|tuple|str|int|bool|float|arr|obj)$")
COMPREHENSIONS = (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)
NUMERIC = ("int", "float")
# `q` 是 api-contract.md §5.3 钉死的全文搜索参数名，不是随手起的单字母
CONTRACT_NAMES = frozenset({"q"})

# 上游 API 定死的形参名——改名即断，本仓无权决定它叫什么。
# 按文件收窄而非全局放行：否则以后任何一处 `external: bool` 都能溜过去。
# `external`：asyncua 的 UaProcessor 以 `external=True` **关键字**调用
# create_session（uaprocessor.py:198），改名即 TypeError。
# `delete_subs`：覆盖 InternalSession.close_session 时形参名必须与基类一致，
# 否则 pyright 判 LSP 不兼容——命名闸与类型闸冲突时以第三方定死的那个为准。
# 两条都由 tests/contract/test_runtime_asyncua_contract.py 钉住。
UPSTREAM_BOOL_NAMES: dict[str, frozenset[str]] = {
    "apps/instance/runtime/sessions.py": frozenset({"external", "delete_subs"}),
}


def _upstream_allows(path: Path, name: str) -> bool:
    """这个名字是上游 API 定死的，本仓改不得。

    Args: path, name。
    """
    return any(
        str(path).endswith(suffix) and name in names
        for suffix, names in UPSTREAM_BOOL_NAMES.items()
    )


def _all_python() -> list[Path]:
    found = list(python_sources())
    for root in python_test_roots():
        found.extend(iter_files(root, PY))
    return found


def _bound_names(tree: ast.Module) -> Iterator[tuple[int, str]]:
    """产出模块里全部被绑定的名字（赋值目标、循环变量、形参、异常别名）。

    Args: tree。
    """
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
            yield node.lineno, node.id
        elif isinstance(node, ast.arg):
            yield node.lineno, node.arg
        elif isinstance(node, ast.ExceptHandler) and node.name:
            yield node.lineno, node.name


def _comprehension_names(tree: ast.Module) -> set[str]:
    """推导式自己的循环变量——两行内的 i/k/v 是允许的。

    Args: tree。
    """
    names: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, COMPREHENSIONS):
            continue
        for generator in node.generators:
            for name in ast.walk(generator.target):
                if isinstance(name, ast.Name):
                    names.add(name.id)
    return names


def check_boolean_names() -> list[Violation]:
    """标注为 `bool` 的名字要有 is_/has_/should_ 前缀或 _enabled 后缀。"""
    found: list[Violation] = []
    for path in _all_python():
        tree = parse(path)
        if tree is None:
            continue
        for line, name in _annotated_bools(tree):
            if (
                name.startswith(BOOL_PREFIX)
                or name.endswith(BOOL_SUFFIX)
                or _upstream_allows(path, name)
            ):
                continue
            found.append(
                Violation(
                    "布尔要 is_/has_/should_ 前缀",
                    at(path, line),
                    name,
                )
            )
    return found


def _annotated_bools(tree: ast.Module) -> Iterator[tuple[int, str]]:
    for node in ast.walk(tree):
        if isinstance(node, ast.AnnAssign) and _is_bool(node.annotation):
            if isinstance(node.target, ast.Name):
                yield node.lineno, node.target.id
        elif isinstance(node, ast.arg) and _is_bool(node.annotation):
            yield node.lineno, node.arg


def _is_bool(annotation: ast.expr | None) -> bool:
    return isinstance(annotation, ast.Name) and annotation.id == "bool"


def _numeric_names(tree: ast.Module) -> Iterator[tuple[int, str]]:
    """产出确实装着数字的名字：标注为 int/float 的，或赋了数字字面量的。

    ⚠ 只看名字会把 `NEEDS_TIMEOUT = frozenset(...)` 这类名单也算成时间量。
    Args: tree。
    """
    for node in ast.walk(tree):
        yield from _numeric_of(node)


def _numeric_of(node: ast.AST) -> Iterator[tuple[int, str]]:
    if isinstance(node, ast.arg) and _is_numeric(node.annotation):
        yield node.lineno, node.arg
    elif isinstance(node, ast.AnnAssign) and _is_numeric(node.annotation):
        if isinstance(node.target, ast.Name):
            yield node.lineno, node.target.id
    elif isinstance(node, ast.Assign) and _is_number(node.value):
        yield from (
            (node.lineno, target.id)
            for target in node.targets
            if isinstance(target, ast.Name)
        )


def _is_numeric(annotation: ast.expr | None) -> bool:
    if isinstance(annotation, ast.Name):
        return annotation.id in NUMERIC
    if isinstance(annotation, ast.BinOp):
        return _is_numeric(annotation.left) or _is_numeric(annotation.right)
    return False


def _is_number(value: ast.expr | None) -> bool:
    return isinstance(value, ast.Constant) and isinstance(
        value.value, int | float
    )


def check_units_in_names() -> list[Violation]:
    """带时间语义的量必须把单位写进名字。"""
    found: list[Violation] = []
    for path in _all_python():
        tree = parse(path)
        if tree is None:
            continue
        for line, name in _numeric_names(tree):
            lowered = name.lower()
            if TIMED.search(lowered) and not UNIT_SUFFIX.search(lowered):
                found.append(
                    Violation(
                        "带单位的量要有单位后缀",
                        at(path, line),
                        f"{name}；写成 {name}_s / {name}_ms",
                    )
                )
    return found


def check_no_abbreviations() -> list[Violation]:
    """不用缩写，领域内公认的（opcua / ws / id / db）除外。"""
    found: list[Violation] = []
    for path in _all_python():
        tree = parse(path)
        if tree is None:
            continue
        for line, name in _bound_names(tree):
            if name.lstrip("_").lower() in ABBREVIATIONS:
                found.append(Violation("不用缩写", at(path, line), name))
    return found


def check_no_single_letter_names() -> list[Violation]:
    """单字母变量只在两行内的推导式里允许。"""
    found: list[Violation] = []
    for path in _all_python():
        tree = parse(path)
        if tree is None:
            continue
        allowed = _comprehension_names(tree) | CONTRACT_NAMES
        for line, name in _bound_names(tree):
            if len(name) != 1 or not name.islower() or name in allowed:
                continue
            found.append(Violation("不用单字母变量", at(path, line), name))
    return found


def check_no_type_in_name() -> list[Violation]:
    """名字里不带类型：`node_list` 写成 `nodes`。"""
    found: list[Violation] = []
    for path in _all_python():
        tree = parse(path)
        if tree is None:
            continue
        for line, name in _bound_names(tree):
            if TYPE_IN_NAME.search(name.lower()):
                found.append(Violation("名字里不带类型", at(path, line), name))
    return found


CHECKS = (
    check_boolean_names,
    check_units_in_names,
    check_no_abbreviations,
    check_no_single_letter_names,
    check_no_type_in_name,
)


if __name__ == "__main__":
    raise SystemExit(main("Python 命名检查", CHECKS))
