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
# 回填走独立批处理任务：迁移只负责结构。⚠ 表名要认 `schema.表` 与带引号的
# 写法：本仓的迁移一律带 schema，只认裸表名等于这条规则从不触发
BACKFILL = re.compile(
    r"\bUPDATE\s+[\w\".]+\s+SET\b"
    r"|\bINSERT\s+INTO\s+[\w\".]+\s*(?:\([^)]*\))?\s*SELECT\b"
    r"|\bDELETE\s+FROM\b",
    re.IGNORECASE,
)
# 已上线迁移里登记过的回填例外：(文件名, 所在函数) → 理由。已应用的迁移不改写
BACKFILL_ALLOWED: dict[tuple[str, str], str] = {
    (
        "2026_08_12_2130-c63d4f2a80e1_guard_incomplete_batches.py",
        "downgrade",
    ): "只在回退时跑：小分片表里的 skipped 归回 pending，旧 CHECK 才建得起来",
}
# f-string 里的插值在判定时换成这个占位，让 `UPDATE {表} SET` 仍长得像 SQL
SQL_PLACEHOLDER = "x"
# 存量表上一步到位加约束的那几个 op：建约束时全表扫描并持 ACCESS EXCLUSIVE
ONE_STEP_CONSTRAINTS = (
    "create_check_constraint",
    "create_foreign_key",
    "create_unique_constraint",
)
# 手写 SQL 里加约束的那一句；取出约束种类与其后的全部文字
RAW_ADD_CONSTRAINT = re.compile(
    r"\bADD\s+CONSTRAINT\s+[\w\"]+\s+(CHECK|FOREIGN\s+KEY|UNIQUE)\b(.*)",
    re.IGNORECASE | re.DOTALL,
)
RAW_ALTER_TABLE = re.compile(
    r"\bALTER\s+TABLE\s+(?:ONLY\s+)?([\w\".]+)", re.IGNORECASE
)
# 已上线迁移里一步加约束的那几处：文件名 → 理由。已应用的迁移不改写
CONSTRAINT_ALLOWED: dict[str, str] = {
    "2026_08_24_1400-b8c34e19d70f_widen_binding_source_kind.py": (
        "已上线；绑定表当时很小"
    ),
    "2026_08_12_2130-c63d4f2a80e1_guard_incomplete_batches.py": (
        "已上线；分片表是小表"
    ),
    "2026_08_12_1830-b52e7d0c41a9_add_ac_startup_shards.py": (
        "已上线；约束列是同一次刚加的、批次表是小表"
    ),
    "2026_09_03_1000-a7e1c93b6d40_add_llm_provider_kind.py": (
        "已上线；供应商配置表只有几行"
    ),
    "2026_09_03_1010-c8f2b41d7e35_add_credential_provider_ref.py": (
        "已上线；凭据表只有几行，约束列是同一次刚加的全空列"
    ),
}
# 加值要迁移、删值几乎不可能、改序静默改语义
NATIVE_ENUM = re.compile(r"\bsa\.Enum\(|postgresql\.ENUM\(")
# `op.create_index(名字, 表名, 列)` —— 取表名至少要有两个位置参数
INDEX_ARGS = 2
# Postgres 的标识符上限。超了 SQLAlchemy 在 DDL 编译期抛 IdentifierError
MAX_IDENTIFIER = 63
# 只拿「长得像库对象名」的字面量比长度，别把 SQL 片段与说明文字算进来
IDENTIFIER_SHAPE = re.compile(r"(?:ix|uq|ck|fk|pk)_[a-z0-9_]+")
# 唯一放行的改类型：`varchar(n)` 加宽成 `text`。它二进制兼容，PG 不重写全表，
# 滚动发布期间也没有坏掉的那一版——旧代码写得进去的值，加宽之后照样写得进去
WIDEN_TO = "Text"
WIDEN_FROM = ("String", "VARCHAR", "Unicode")


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


def _sql_text(node: ast.expr | None) -> str | None:
    """`op.execute` 的实参取成 SQL 文本；f-string 的插值换成占位。

    ⚠ 只看字面量的话，一条 `f"UPDATE {表} SET …"` 整句漏判。
    Args: node。
    """
    if isinstance(node, ast.Constant):
        return node.value if isinstance(node.value, str) else None
    if not isinstance(node, ast.JoinedStr):
        return None
    return "".join(
        str(part.value) if isinstance(part, ast.Constant) else SQL_PLACEHOLDER
        for part in node.values
    )


def _scopes(tree: ast.Module) -> dict[int, str]:
    """每个调用节点所在的顶层函数名，按节点 id 查。

    Args: tree。
    """
    found: dict[int, str] = {}
    for node in tree.body:
        if isinstance(node, ast.FunctionDef):
            for child in ast.walk(node):
                found[id(child)] = node.name
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
        scopes = _scopes(tree)
        for call in _op_calls(tree, "execute"):
            text = _sql_text(call.args[0] if call.args else None)
            if text is None or not BACKFILL.search(text):
                continue
            if (path.name, scopes.get(id(call), "")) not in BACKFILL_ALLOWED:
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


def _type_name(node: ast.expr | None) -> str | None:
    """`sa.Text()` / `Text()` 这样的类型构造取出类型名。

    Args: node（关键字实参的值；不是类型构造就给 None）。
    """
    if not isinstance(node, ast.Call):
        return None
    target = node.func
    if isinstance(target, ast.Attribute):
        return target.attr
    if isinstance(target, ast.Name):
        return target.id
    return None


def _retypes(call: ast.Call, *, to: str, sources: tuple[str, ...]) -> bool:
    """这一次改类型是不是「`sources` 里的某个类型 → `to`」。

    ⚠ 两头都要写明：`existing_type` 不写的话，一个 `integer → text` 在 AST 上
    与加宽长得一模一样，而它是真会重写全表的那一种。

    Args: call（一次 `op.alter_column` 调用）, to（改成什么）,
        sources（原来是什么）。
    """
    given = {keyword.arg: keyword.value for keyword in call.keywords}
    if _type_name(given.get("type_")) != to:
        return False
    return _type_name(given.get("existing_type")) in sources


def check_no_rename_or_retype() -> list[Violation]:
    """改列名与原地改类型都会重写全表并锁表，且滚动发布期间必坏一版代码。

    例外只有一条：`varchar(n)` 加宽成 `text`（`database-standard.md` §5.2）。
    ⚠ 例外**认函数**：加宽只许写在 `upgrade` 里，它的镜像（`text` 收回
    `varchar(n)`）只许写在 `downgrade` 里。不认函数的话，同一条例外反着写
    就是一次真的缩窄，而缩窄会在存量值超长时失败。
    """
    found: list[Violation] = []
    for path in _all_versions():
        tree = parse(path)
        if tree is None:
            continue
        forward = _function(tree, "upgrade")
        backward = _function(tree, "downgrade")
        widening = _op_calls(forward, "alter_column") if forward else []
        mirroring = _op_calls(backward, "alter_column") if backward else []
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
            if "type_" not in named:
                continue
            allowed = (
                call in widening
                and _retypes(call, to=WIDEN_TO, sources=WIDEN_FROM)
            ) or (
                call in mirroring
                and any(
                    _retypes(call, to=one, sources=(WIDEN_TO,))
                    for one in WIDEN_FROM
                )
            )
            if not allowed:
                found.append(
                    Violation(
                        "禁止原地改类型",
                        at(path, call.lineno),
                        "同改名：加新列再切读（只有加宽到 text 例外）",
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


def _upgrade_scope(tree: ast.Module) -> list[ast.FunctionDef]:
    """`upgrade` 连同它（层层）调到的本文件顶层函数。

    ⚠ 约束常写在 `_swap` 这类辅助函数里；只看 `upgrade` 本体会整片漏判。
    Args: tree。
    """
    functions = {
        node.name: node
        for node in tree.body
        if isinstance(node, ast.FunctionDef)
    }
    pending = ["upgrade"]
    reached: dict[str, ast.FunctionDef] = {}
    while pending:
        name = pending.pop()
        function = functions.get(name)
        if function is None or name in reached or name == "downgrade":
            continue
        reached[name] = function
        pending.extend(
            child.func.id
            for child in ast.walk(function)
            if isinstance(child, ast.Call) and isinstance(child.func, ast.Name)
        )
    return list(reached.values())


def _table_of(path: Path, node: ast.expr | None) -> str | None:
    """表名实参取成字符串；是模块级常量名就按常量取值。

    Args: path, node。
    """
    if isinstance(node, ast.Constant):
        return str(node.value)
    if isinstance(node, ast.Name):
        return _literal(path, node.id)
    return None


def _fresh_tables(path: Path, scope: list[ast.FunctionDef]) -> set[str]:
    """这次升级里新建的表。

    Args: path, scope。
    """
    names: set[str] = set()
    for function in scope:
        for call in _op_calls(function, "create_table"):
            table = _table_of(path, call.args[0] if call.args else None)
            if table is not None:
                names.add(table)
    return names


def _one_step_op(path: Path, call: ast.Call, fresh: set[str]) -> bool:
    """这一次 `op.create_*_constraint` 是不是在存量表上一步到位。

    Args: path, call, fresh（本次新建的表）。
    """
    table = _table_of(path, call.args[1] if len(call.args) > 1 else None)
    if table in fresh:
        return False
    return not any(
        keyword.arg == "postgresql_not_valid" and _is_true(keyword.value)
        for keyword in call.keywords
    )


def _one_step_sql(text: str, fresh: set[str]) -> bool:
    """手写的 `ADD CONSTRAINT` 是不是在存量表上一步到位。

    Args: text, fresh（本次新建的表）。
    """
    added = RAW_ADD_CONSTRAINT.search(text)
    if added is None:
        return False
    table = RAW_ALTER_TABLE.search(text)
    if table is not None and table.group(1).split(".")[-1].strip('"') in fresh:
        return False
    rest = added.group(2).upper()
    if added.group(1).upper() == "UNIQUE":
        return "USING INDEX" not in rest
    return "NOT VALID" not in rest


def check_constraint_on_existing_table() -> list[Violation]:
    """存量表加 CHECK / 外键先 NOT VALID 再 VALIDATE，唯一约束走 USING INDEX。

    ⚠ 一步到位的加约束持 ACCESS EXCLUSIVE 扫全表，期间这张表读写全停
    （database-standard.md §5.2）。
    """
    found: list[Violation] = []
    for path in _all_versions():
        tree = parse(path)
        if tree is None or path.name in CONSTRAINT_ALLOWED:
            continue
        scope = _upgrade_scope(tree)
        fresh = _fresh_tables(path, scope)
        for function in scope:
            calls = [
                call
                for name in ONE_STEP_CONSTRAINTS
                for call in _op_calls(function, name)
                if _one_step_op(path, call, fresh)
            ]
            calls.extend(
                call
                for call in _op_calls(function, "execute")
                if _one_step_sql(
                    _sql_text(call.args[0] if call.args else None) or "",
                    fresh,
                )
            )
            found.extend(
                Violation(
                    "存量表加约束必须分两步",
                    at(path, call.lineno),
                    "ADD … NOT VALID 再 VALIDATE；唯一约束先建唯一索引再 "
                    "USING INDEX",
                )
                for call in calls
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


def check_identifiers_fit_postgres() -> list[Violation]:
    """迁移里写死的标识符不许超 63 字符。

    ⚠ 这条只在**全新库**上才暴露：老库早就建好了那个对象，`upgrade head`
    没有它要执行，于是本地与已部署环境全绿，而任何一次干净部署当场起不来。
    SQLAlchemy 在 DDL 编译期就抛 IdentifierError，连库都没连上。
    """
    found: list[Violation] = []
    for path in _all_versions():
        tree = parse(path)
        if tree is None:
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.Constant):
                continue
            value = node.value
            if not isinstance(value, str) or len(value) <= MAX_IDENTIFIER:
                continue
            if not IDENTIFIER_SHAPE.fullmatch(value):
                continue
            found.append(
                Violation(
                    f"标识符不许超过 {MAX_IDENTIFIER} 字符",
                    at(path, node.lineno),
                    f"{value}（{len(value)} 字符）",
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
    check_constraint_on_existing_table,
    check_downgrade_is_honest,
    check_single_head_per_service,
    check_identifiers_fit_postgres,
)


if __name__ == "__main__":
    raise SystemExit(main("数据库迁移检查", CHECKS))
