#!/usr/bin/env python3
"""迁移闸：database-standard.md §5 与 §3。

数据库是系统里唯一不能回滚的东西。这一组拦的都是「跑之前看不出、跑之后
收不回」的写法：无 lock_timeout 的 ALTER 会把热表冻住，改名与原地改类型
会让滚动发布期间必然有一版代码是坏的。
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

from _report import Violation, at, main, parse, read, service_dirs

# 拿不到锁的 ALTER 会排队，排在它后面的普通查询也会一起排队
LOCK_TIMEOUT = re.compile(r"SET\s+lock_timeout", re.IGNORECASE)
# 回填走独立批处理任务：迁移只负责结构
BACKFILL = re.compile(
    r"\b(UPDATE\s+\w|INSERT\s+INTO\s+\w+\s*(\([^)]*\))?\s*SELECT|DELETE\s+FROM)\b",
    re.IGNORECASE,
)
# 加值要迁移、删值几乎不可能、改序静默改语义
NATIVE_ENUM = re.compile(r"\bsa\.Enum\(|postgresql\.ENUM\(")
# `op.create_index(名字, 表名, 列)` —— 取表名至少要有两个位置参数
INDEX_ARGS = 2


def _versions(service: Path) -> list[Path]:
    directory = service / "migrations" / "versions"
    if not directory.is_dir():
        return []
    return sorted(path for path in directory.glob("*.py"))


def _all_versions() -> list[Path]:
    found: list[Path] = []
    for service in service_dirs():
        found.extend(_versions(service))
    return found


def _function(tree: ast.Module, name: str) -> ast.FunctionDef | None:
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    return None


def _op_calls(node: ast.AST, name: str) -> list[ast.Call]:
    found: list[ast.Call] = []
    for child in ast.walk(node):
        if not isinstance(child, ast.Call):
            continue
        target = child.func
        if isinstance(target, ast.Attribute) and target.attr == name:
            found.append(child)
    return found


def check_upgrade_sets_lock_timeout() -> list[Violation]:
    """⚠ 单个迁移语句就能把一张热表的全部访问冻住。宁可迁移失败重试。"""
    return [
        Violation(
            "迁移开头必须设 lock_timeout",
            at(path),
            "op.execute(\"SET lock_timeout = '3s'\")",
        )
        for path in _all_versions()
        if not LOCK_TIMEOUT.search(read(path))
    ]


def check_no_backfill_in_migration() -> list[Violation]:
    """迁移里禁止数据回填——它把发布时长变成不可预测，失败还难以续跑。"""
    found: list[Violation] = []
    for path in _all_versions():
        tree = parse(path)
        if tree is None:
            continue
        for call in _op_calls(tree, "execute"):
            statement = call.args[0] if call.args else None
            if not isinstance(statement, ast.Constant):
                continue
            if BACKFILL.search(str(statement.value)):
                found.append(
                    Violation(
                        "迁移里禁止回填数据",
                        at(path, call.lineno),
                        "走 worker 的批处理任务，分批提交、可中断、可重入",
                    )
                )
        found.extend(
            Violation(
                "迁移里禁止回填数据",
                at(path, call.lineno),
                "bulk_insert 属于数据而非结构",
            )
            for call in _op_calls(tree, "bulk_insert")
        )
    return found


def check_no_rename_or_retype() -> list[Violation]:
    """改列名与原地改类型都会重写全表并锁表，且滚动发布期间必坏一版代码。"""
    found: list[Violation] = []
    for path in _all_versions():
        tree = parse(path)
        if tree is None:
            continue
        for call in _op_calls(tree, "alter_column"):
            named = {keyword.arg for keyword in call.keywords}
            if "new_column_name" in named:
                found.append(
                    Violation(
                        "禁止改列名",
                        at(path, call.lineno),
                        "走「加新列 → 双写 → 回填 → 切读 → 删旧列」四次发布",
                    )
                )
            if "type_" in named:
                found.append(
                    Violation(
                        "禁止原地改类型",
                        at(path, call.lineno),
                        "同改名：加新列再切读",
                    )
                )
    return found


def check_no_native_enum() -> list[Violation]:
    """枚举用 varchar + CHECK，不用原生 ENUM 类型。"""
    found: list[Violation] = []
    for path in _all_versions():
        for number, line in enumerate(read(path).splitlines(), start=1):
            if NATIVE_ENUM.search(line):
                found.append(
                    Violation(
                        "禁止原生 ENUM",
                        at(path, number),
                        "改序会静默改变全部已存数据的含义",
                    )
                )
    return found


def check_timestamps_carry_timezone() -> list[Violation]:
    """时刻一律 `timestamptz` 存 UTC——落库即失去口径，事后无法修复。"""
    found: list[Violation] = []
    for path in _all_versions():
        tree = parse(path)
        if tree is None:
            continue
        for call in _op_calls(tree, "DateTime"):
            timezone = [
                keyword
                for keyword in call.keywords
                if keyword.arg == "timezone"
            ]
            if timezone and _is_true(timezone[0].value):
                continue
            found.append(
                Violation(
                    "时刻必须是 timestamptz",
                    at(path, call.lineno),
                    "sa.DateTime(timezone=True)",
                )
            )
    return found


def _is_true(value: ast.expr) -> bool:
    return isinstance(value, ast.Constant) and value.value is True


def _created_tables(node: ast.AST) -> set[str]:
    names: set[str] = set()
    for call in _op_calls(node, "create_table"):
        if call.args and isinstance(call.args[0], ast.Constant):
            names.add(str(call.args[0].value))
    return names


def check_index_on_existing_table_is_concurrent() -> list[Violation]:
    """大表加索引必须 `CONCURRENTLY`，否则建索引期间写入全被堵住。"""
    found: list[Violation] = []
    for path in _all_versions():
        tree = parse(path)
        if tree is None:
            continue
        upgrade = _function(tree, "upgrade")
        if upgrade is None:
            continue
        fresh = _created_tables(upgrade)
        for call in _op_calls(upgrade, "create_index"):
            if len(call.args) < INDEX_ARGS or not isinstance(
                call.args[1], ast.Constant
            ):
                continue
            table = str(call.args[1].value)
            concurrent = any(
                keyword.arg == "postgresql_concurrently"
                and _is_true(keyword.value)
                for keyword in call.keywords
            )
            if table in fresh or concurrent:
                continue
            found.append(
                Violation(
                    "给存量表加索引必须 CONCURRENTLY",
                    at(path, call.lineno),
                    f"{table}；并配 autocommit_block()",
                )
            )
    return found


def check_downgrade_is_honest() -> list[Violation]:
    """⚠ 假装能回滚的空 downgrade 比明确的不可逆更危险。"""
    found: list[Violation] = []
    for path in _all_versions():
        tree = parse(path)
        if tree is None:
            continue
        downgrade = _function(tree, "downgrade")
        if downgrade is None:
            found.append(Violation("迁移必须有 downgrade", at(path), "缺函数"))
            continue
        body = [
            node
            for node in downgrade.body
            if not isinstance(node, ast.Pass) and not _is_docstring(node)
        ]
        if not body:
            found.append(
                Violation(
                    "downgrade 不许是空实现",
                    at(path, downgrade.lineno),
                    "不可逆就显式 raise 并写明原因",
                )
            )
    return found


def _is_docstring(node: ast.stmt) -> bool:
    return isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant)


def check_single_head_per_service() -> list[Violation]:
    """迁移链按服务独立，各自单头——多头会让 `upgrade head` 无法解析。"""
    found: list[Violation] = []
    for service in service_dirs():
        versions = _versions(service)
        if not versions:
            continue
        revisions = {
            revision
            for path in versions
            if (revision := _revision(path)) is not None
        }
        parents = {_down_revision(path) for path in versions}
        heads = sorted(revisions - parents)
        if len(heads) > 1:
            found.append(
                Violation(
                    "迁移链必须单头",
                    at(service / "migrations" / "versions"),
                    f"{len(heads)} 个头：{heads}",
                )
            )
    return found


def _literal(path: Path, name: str) -> str | None:
    tree = parse(path)
    if tree is None:
        return None
    for node in tree.body:
        if not isinstance(node, ast.AnnAssign | ast.Assign):
            continue
        targets = (
            [node.target] if isinstance(node, ast.AnnAssign) else node.targets
        )
        if not any(
            isinstance(target, ast.Name) and target.id == name
            for target in targets
        ):
            continue
        if isinstance(node.value, ast.Constant):
            value = node.value.value
            return str(value) if value is not None else None
    return None


def _revision(path: Path) -> str | None:
    return _literal(path, "revision")


def _down_revision(path: Path) -> str | None:
    return _literal(path, "down_revision")


CHECKS = (
    check_upgrade_sets_lock_timeout,
    check_no_backfill_in_migration,
    check_no_rename_or_retype,
    check_no_native_enum,
    check_timestamps_carry_timezone,
    check_index_on_existing_table_is_concurrent,
    check_downgrade_is_honest,
    check_single_head_per_service,
)


if __name__ == "__main__":
    raise SystemExit(main("数据库迁移检查", CHECKS))
