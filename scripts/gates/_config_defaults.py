"""从真实 AST 绑定提取危险配置的字面量默认值。"""

from __future__ import annotations

import ast
import re

DANGEROUS_DEFAULTS: tuple[tuple[re.Pattern[str], bool | str, str], ...] = (
    (re.compile(r"(?:app_)?cors_origins"), "*", "CORS 放开全部来源"),
    (re.compile(r"(?:app_)?debug(?:_enabled)?"), True, "DEBUG 默认开"),
    (
        re.compile(r"(?:(?:tls|ssl|http|https)_)?verify(?:_enabled)?"),
        False,
        "TLS 校验默认关",
    ),
    (
        re.compile(r"(?:(?:db|database)_)?auto_create(?:_[a-z0-9]+)*"),
        True,
        "自动建表默认开",
    ),
)


def _field_names(tree: ast.Module) -> frozenset[str]:
    names = {"Field", "pydantic.Field"}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            for alias in node.names:
                if alias.name != "Field":
                    continue
                name = alias.asname or alias.name
                if node.module in {"pydantic", "pydantic.fields"}:
                    names.add(name)
                else:
                    names.discard(name)
        if isinstance(node, ast.Import):
            names.update(
                f"{alias.asname or alias.name}.Field"
                for alias in node.names
                if alias.name == "pydantic"
            )
    return frozenset(names)


def _field_default(value: ast.expr, field_names: frozenset[str]) -> ast.expr:
    if not isinstance(value, ast.Call):
        return value
    if ast.unparse(value.func) not in field_names:
        return value
    keywords = {keyword.arg: keyword.value for keyword in value.keywords}
    if "default" in keywords:
        return keywords["default"]
    if value.args:
        return value.args[0]
    factory = keywords.get("default_factory")
    return factory.body if isinstance(factory, ast.Lambda) else value


def _target_name(node: ast.expr) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    if isinstance(node, ast.Subscript):
        return _literal_name(node.slice)
    return ""


def _literal_name(node: ast.expr | None) -> str:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return ""


def _target_defaults(
    target: ast.expr, value: ast.expr
) -> list[tuple[str, ast.expr]]:
    if isinstance(target, ast.Tuple | ast.List):
        if not isinstance(value, ast.Tuple | ast.List):
            return []
        if len(target.elts) != len(value.elts):
            return []
        return [
            binding
            for child, default in zip(target.elts, value.elts, strict=True)
            for binding in _target_defaults(child, default)
        ]
    name = _target_name(target)
    return [(name, value)] if name else []


def _parameter_defaults(node: ast.arguments) -> list[tuple[str, ast.expr]]:
    positional = [*node.posonlyargs, *node.args]
    start = len(positional) - len(node.defaults)
    pairs = [
        *zip(positional[start:], node.defaults, strict=True),
        *zip(node.kwonlyargs, node.kw_defaults, strict=True),
    ]
    return [
        (argument.arg, value) for argument, value in pairs if value is not None
    ]


def _configuration_defaults(node: ast.AST) -> list[tuple[str, ast.expr]]:
    if (
        isinstance(node, ast.AnnAssign | ast.NamedExpr)
        and node.value is not None
    ):
        return _target_defaults(node.target, node.value)
    if isinstance(node, ast.Assign):
        return [
            binding
            for target in node.targets
            for binding in _target_defaults(target, node.value)
        ]
    if isinstance(node, ast.arguments):
        return _parameter_defaults(node)
    if isinstance(node, ast.keyword) and node.arg is not None:
        return [(node.arg, node.value)]
    if isinstance(node, ast.Dict):
        return [
            (name, value)
            for key, value in zip(node.keys, node.values, strict=True)
            if (name := _literal_name(key))
        ]
    return []


def _contains_wildcard(value: ast.expr) -> bool:
    if isinstance(value, ast.Constant):
        return value.value == "*"
    if isinstance(value, ast.List | ast.Tuple | ast.Set):
        return any(_contains_wildcard(item) for item in value.elts)
    return False


def _is_dangerous(value: ast.expr, expected: bool | str) -> bool:
    if isinstance(expected, str):
        return _contains_wildcard(value)
    return isinstance(value, ast.Constant) and value.value is expected


def dangerous_default_reasons(tree: ast.Module) -> list[str]:
    """按配置名称与默认值返回每条命中的安全规则。Args: tree。"""
    field_names = _field_names(tree)
    defaults = [
        (name.lower(), _field_default(value, field_names))
        for node in ast.walk(tree)
        for name, value in _configuration_defaults(node)
    ]
    return [
        reason
        for pattern, expected, reason in DANGEROUS_DEFAULTS
        if any(
            pattern.fullmatch(name) and _is_dangerous(value, expected)
            for name, value in defaults
        )
    ]
