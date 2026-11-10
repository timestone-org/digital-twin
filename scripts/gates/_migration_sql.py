"""迁移闸用到的 SQL 文本判定：f-string 取文本、手写的加约束是否一步到位。"""

from __future__ import annotations

import ast
import re

# f-string 里的插值在判定时换成这个占位，让 `UPDATE {表} SET` 仍长得像 SQL
SQL_PLACEHOLDER = "x"
# 手写 SQL 里加约束的那一句；取出约束种类与其后的全部文字
RAW_ADD_CONSTRAINT = re.compile(
    r"\bADD\s+CONSTRAINT\s+[\w\"]+\s+(CHECK|FOREIGN\s+KEY|UNIQUE)\b(.*)",
    re.IGNORECASE | re.DOTALL,
)
RAW_ALTER_TABLE = re.compile(
    r"\bALTER\s+TABLE\s+(?:ONLY\s+)?([\w\".]+)", re.IGNORECASE
)


def sql_text(node: ast.expr | None) -> str | None:
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


def one_step_sql(text: str, fresh: set[str]) -> bool:
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
