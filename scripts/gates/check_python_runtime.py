#!/usr/bin/env python3
"""Python 运行期正确性闸：code-style-python.md §5–§7、database-standard.md §6。

这一组拦的都是「不会报错、只会在运行期偶发出错」的写法：丢引用的任务、
多副本下不一致的模块级状态、越层直返 ORM 模型、以及提前 commit 切断的事务。
"""

from __future__ import annotations

import ast
from pathlib import Path

from _report import (
    Violation,
    at,
    functions,
    main,
    parse,
    python_sources,
)

MUTABLE_LITERALS = (ast.List, ast.Dict, ast.Set, ast.ListComp, ast.DictComp)
MUTATORS = frozenset(
    {"append", "extend", "insert", "pop", "remove", "clear", "update", "add"}
)
# 顶层求值即连外部资源，装配必须在组合根显式做
IMPORT_TIME_IO = frozenset(
    {
        "create_engine",
        "create_async_engine",
        "connect",
        "from_url",
        "Redis",
        "Thread",
        "start",
        "run",
    }
)
# 没有超时的跨进程调用会在下游卡住时耗光连接池与事件循环
NEEDS_TIMEOUT = frozenset({"AsyncClient", "Client"})


def _call_name(node: ast.Call) -> str:
    target = node.func
    if isinstance(target, ast.Attribute):
        return target.attr
    if isinstance(target, ast.Name):
        return target.id
    return ""


def check_create_task_keeps_reference() -> list[Violation]:
    """事件循环只持有任务的弱引用，丢了引用的任务可能随时消失。"""
    found: list[Violation] = []
    for path in python_sources():
        tree = parse(path)
        if tree is None:
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.Expr):
                continue
            call = node.value
            if isinstance(call, ast.Call) and _call_name(call) == "create_task":
                found.append(
                    Violation(
                        "create_task 必须保存强引用",
                        at(path, node.lineno),
                        "存进集合并 add_done_callback(集合.discard)",
                    )
                )
    return found


def _mutated_names(tree: ast.Module) -> set[str]:
    names: set[str] = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        target = node.func
        if (
            isinstance(target, ast.Attribute)
            and target.attr in MUTATORS
            and isinstance(target.value, ast.Name)
        ):
            names.add(target.value.id)
    return names


def check_no_module_level_mutable_state() -> list[Violation]:
    """模块级 list/dict/set 在多副本下不一致、在测试之间互相污染。"""
    found: list[Violation] = []
    for path in python_sources():
        tree = parse(path)
        if tree is None:
            continue
        mutated = _mutated_names(tree)
        for node in tree.body:
            found.extend(_module_state(path, node, mutated))
    return found


def _module_state(
    path: Path, node: ast.stmt, mutated: set[str]
) -> list[Violation]:
    if not isinstance(node, ast.Assign | ast.AnnAssign):
        return []
    value = node.value
    if value is None or not isinstance(value, MUTABLE_LITERALS):
        return []
    targets = node.targets if isinstance(node, ast.Assign) else [node.target]
    names = [
        target.id
        for target in targets
        if isinstance(target, ast.Name) and not target.id.startswith("__")
    ]
    risky = [name for name in names if not name.isupper() or name in mutated]
    if not risky:
        return []
    return [
        Violation(
            "禁止模块级可变状态",
            at(path, node.lineno),
            f"{', '.join(risky)}；共享状态走 Redis 或数据库",
        )
    ]


def check_no_import_time_side_effects() -> list[Violation]:
    """模块顶层不许连库、起线程、注册全局钩子——装配在组合根显式做。"""
    found: list[Violation] = []
    for path in python_sources():
        tree = parse(path)
        if tree is None:
            continue
        for node in tree.body:
            found.extend(_import_time_io(path, node))
    return found


def _import_time_io(path: Path, node: ast.stmt) -> list[Violation]:
    call: ast.Call | None = None
    if (isinstance(node, ast.Expr) and isinstance(node.value, ast.Call)) or (
        isinstance(node, ast.Assign) and isinstance(node.value, ast.Call)
    ):
        call = node.value
    if call is None or _call_name(call) not in IMPORT_TIME_IO:
        return []
    return [
        Violation(
            "禁止 import 时的副作用",
            at(path, node.lineno),
            f"{_call_name(call)}()，挪进 lifespan 或组合根",
        )
    ]


def _layer_files(layer: str) -> list[Path]:
    return [path for path in python_sources() if f"/{layer}/" in str(path)]


def check_api_does_not_touch_models() -> list[Violation]:
    """ORM 模型绝不直接返给 HTTP 层：改列名就是破坏性 API 变更。"""
    found: list[Violation] = []
    for path in _layer_files("api"):
        tree = parse(path)
        if tree is None:
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.ImportFrom) or not node.module:
                continue
            if ".models" in node.module or node.module.endswith("models"):
                found.append(
                    Violation(
                        "api/ 不许 import models/",
                        at(path, node.lineno),
                        f"{node.module}；转换在 services/ 边界完成",
                    )
                )
    return found


def check_transaction_boundary() -> list[Violation]:
    """事务边界由 service 层持有：crud 与 api 都不许提交。

    ⚠ 为了先拿 id 而提前 commit，会把一次逻辑操作切成两个事务——
    前半段已落库、后半段失败就是没有回滚手段的中间态。要 id 用 flush()。
    """
    found: list[Violation] = []
    for layer in ("crud", "api"):
        for path in _layer_files(layer):
            tree = parse(path)
            if tree is None:
                continue
            found.extend(_commits(path, tree, layer))
    return found


def _commits(path: Path, tree: ast.Module, layer: str) -> list[Violation]:
    found: list[Violation] = [
        Violation(
            f"{layer}/ 不许提交事务",
            at(path, node.lineno),
            "事务边界在 service 层；要拿 id 用 flush()",
        )
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and _call_name(node) == "commit"
    ]
    return found


def check_cross_process_calls_have_timeout() -> list[Violation]:
    """每个跨进程调用都必须有显式超时，否则慢下游会拖垮整条链路。"""
    found: list[Violation] = []
    for path in python_sources():
        tree = parse(path)
        if tree is None:
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            name = _call_name(node)
            if name not in NEEDS_TIMEOUT:
                continue
            if any(kw.arg == "timeout" for kw in node.keywords):
                continue
            found.append(
                Violation(
                    "跨进程调用必须带超时",
                    at(path, node.lineno),
                    f"{name}(...) 缺 timeout=",
                )
            )
    return found


def check_async_functions_have_no_prefix() -> list[Violation]:
    """异步函数不加 `async_` 前缀——`await` 已经说了它是异步的。"""
    found: list[Violation] = []
    for path in python_sources():
        tree = parse(path)
        if tree is None:
            continue
        found.extend(
            Violation(
                "异步函数不加 async_ 前缀", at(path, node.lineno), node.name
            )
            for node in functions(tree)
            if isinstance(node, ast.AsyncFunctionDef)
            and node.name.startswith("async_")
        )
    return found


CHECKS = (
    check_create_task_keeps_reference,
    check_no_module_level_mutable_state,
    check_no_import_time_side_effects,
    check_api_does_not_touch_models,
    check_transaction_boundary,
    check_cross_process_calls_have_timeout,
    check_async_functions_have_no_prefix,
)


if __name__ == "__main__":
    raise SystemExit(main("Python 运行期正确性检查", CHECKS))
