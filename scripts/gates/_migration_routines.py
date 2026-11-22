"""识别返回 pg_catalog.trigger 的定义体及同批立即执行的 SQL。"""

import re
from collections.abc import Iterator, Sequence
from typing import NamedTuple

_TOKEN = re.compile(
    r"(?P<line>--)|(?P<block>/\*)|(?P<quoted>[eE]'|'|\")"
    r"|(?P<dollar>\$(?:[^\W\d]\w*)?\$)|(?P<word>[^\W\d][\w$]*)"
    r"|(?P<symbol>\S)"
)
_COMMENT_EDGE = re.compile(r"/\*|\*/")
_QUALIFIED_RETURN_WITH_OPTION = 4


class Token(NamedTuple):
    kind: str
    value: str
    start: int
    end: int


def _comment_end(sql: str, start: int) -> int:
    """跨越 PostgreSQL 的可嵌套块注释。Args: sql, start。"""
    depth = 1
    for edge in _COMMENT_EDGE.finditer(sql, start):
        depth += 1 if edge.group() == "/*" else -1
        if not depth:
            return edge.end()
    return len(sql)


def _quoted_end(sql: str, position: int, opening: str) -> int | None:
    """找到字符串或引用名的结尾。Args: sql, position, opening。"""
    quote = opening[-1]
    while position < len(sql):
        char = sql[position]
        if opening.upper() == "E'" and char == "\\":
            position += 2
        elif char != quote:
            position += 1
        elif sql.startswith(quote * 2, position):
            position += 2
        else:
            return position + 1
    return None


def _tokens(sql: str) -> Iterator[Token]:
    """区分关键字、引用标识符、字符串、注释和语句分隔符。Args: sql。"""
    position = 0
    while match := _TOKEN.search(sql, position):
        opening = match.group()
        position = match.end()
        kind = match.lastgroup
        if kind == "line":
            boundary = sql.find("\n", position)
            position = len(sql) if boundary < 0 else boundary + 1
            continue
        if kind == "block":
            position = _comment_end(sql, position)
            continue
        if kind in ("quoted", "dollar"):
            end = _literal_end(sql, position, opening, kind)
            if end is None:
                return
            position = end
            if opening == '"':
                # 引用名区分大小写，SQL 双写的引号才代表名字中的一个引号。
                identifier = sql[match.end() : end - 1].replace('""', '"')
                yield Token("identifier", identifier, match.start(), end)
            else:
                yield Token("literal", "", match.start(), end)
            continue
        yield Token(kind or "symbol", opening.upper(), match.start(), position)


def _literal_end(
    sql: str, position: int, opening: str, kind: str
) -> int | None:
    if kind == "quoted":
        return _quoted_end(sql, position, opening)
    end = sql.find(opening, position)
    return None if end < 0 else end + len(opening)


def _is_name(token: Token, expected: str) -> bool:
    if token.kind == "identifier":
        return token.value == expected
    return token.kind == "word" and token.value == expected.upper()


def _builtin_trigger(tokens: Sequence[Token]) -> bool:
    if len(tokens) < _QUALIFIED_RETURN_WITH_OPTION:
        return False
    schema, dot, name, option = tokens[:_QUALIFIED_RETURN_WITH_OPTION]
    return (
        _is_name(schema, "pg_catalog")
        and dot.kind == "symbol"
        and dot.value == "."
        and _is_name(name, "trigger")
        and option.kind == "word"
        and option.value in ("AS", "LANGUAGE")
    )


def _body(statement: Sequence[Token]) -> Token | None:
    """取显式内置触发器声明的完整定义体。Args: statement。"""
    prefix = tuple(t.value if t.kind == "word" else "" for t in statement[:4])
    if prefix[:2] != ("CREATE", "FUNCTION") and prefix != (
        "CREATE",
        "OR",
        "REPLACE",
        "FUNCTION",
    ):
        return None
    depth = 0
    has_trigger_type = False
    for index, token in enumerate(statement[:-1]):
        if token.kind == "symbol":
            depth += int(token.value == "(") - int(token.value == ")")
            continue
        if depth or token.kind != "word":
            continue
        if token.value == "RETURNS":
            has_trigger_type = _builtin_trigger(statement[index + 1 :])
        elif has_trigger_type and token.value == "AS":
            candidate = statement[index + 1]
            return candidate if candidate.kind == "literal" else None
    return None


def executed_sql(sql: str) -> str:
    """保留立即执行的 SQL，跳过函数定义中的数据操作。Args: sql。"""
    if "function" not in sql.lower():
        return sql
    statement: list[Token] = []
    parts: list[str] = []
    last = 0
    for token in _tokens(sql):
        if token.kind != "symbol" or token.value != ";":
            statement.append(token)
            continue
        body = _body(statement)
        if body is not None:
            parts.append(sql[last : body.start])
            last = body.end
        statement.clear()
    body = _body(statement)
    if body is not None:
        parts.append(sql[last : body.start])
        last = body.end
    parts.append(sql[last:])
    return " ".join(parts)
