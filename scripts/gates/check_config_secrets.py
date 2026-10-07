#!/usr/bin/env python3
"""配置与密钥闸：config-and-secrets.md §3–§6、§8。

弱默认的密钥等于没有密钥；回退链少写一处就是非对称失效；而模板漏一项，
下一个部署的人会撞上一个没有文档的启动失败。
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

from _compose_config import compose_environments, fallback_shape, interpolations

from _report import (
    ROOT,
    Violation,
    at,
    main,
    parse,
    python_sources,
    read,
    service_dirs,
)

# ⚠ 配置组不止 base.py 一处（对象存储那组在 lib/objectstore/settings.py）。
# 只认 base.py 的话，别处那些组的字段对本闸是隐形的——模板漏了也不会红。
LIB_ROOT = ROOT / "server" / "lib" / "src" / "lib"
COMPOSE = ROOT / "docker" / "compose.yml"
ROOT_ENV_EXAMPLE = ROOT / ".env.example"
ROOT_ENV_TEMPLATE = ROOT / ".env.template"

SECRET_WORDS = re.compile(
    r"secret|password|passwd|token|_key$|^key$|credential"
)
# 一旦有 if env == "prod"，生产上跑的那条分支从未在任何地方被测试过
ENV_NAMES = frozenset({"env", "environment", "stage", "profile", "mode"})
ENV_VALUES = frozenset(
    {"prod", "production", "dev", "development", "test", "staging"}
)
# 让本地开发轻松的方式若是「少一道安全检查」，它就不该是默认值
DANGEROUS_DEFAULTS = (
    (re.compile(r"""cors_origins\s*[:=].*\*"""), "CORS 放开全部来源"),
    (re.compile(r"""debug\s*:\s*bool\s*=\s*True"""), "DEBUG 默认开"),
    (re.compile(r"""verify\s*:\s*bool\s*=\s*False"""), "TLS 校验默认关"),
    (re.compile(r"""auto_create\w*\s*:\s*bool\s*=\s*True"""), "自动建表默认开"),
)
ENV_VARIABLE = re.compile(r"^\s*#?\s*([A-Z][A-Z0-9_]*)=")
CHINESE_COMMENT = re.compile(r"[\u4e00-\u9fff]")
# 固定拓扑：角色、探针与网关端口、schema 所有权、证书挂载路径。
FIXED_COMPOSE_FIELDS = frozenset(
    {
        "app_name",
        "app_role",
        "app_http_host",
        "app_http_port",
        "postgres_schema",
        "pki_dir",
    }
)


def _class_fields(
    tree: ast.Module,
) -> dict[str, list[tuple[str, ast.expr | None]]]:
    """按类名收集 `字段: 类型 = 默认值` 形式的配置字段。

    Args: tree。
    """
    classes: dict[str, list[tuple[str, ast.expr | None]]] = {}
    for node in tree.body:
        if not isinstance(node, ast.ClassDef):
            continue
        classes[node.name] = [
            (item.target.id, item.value)
            for item in node.body
            if isinstance(item, ast.AnnAssign)
            and isinstance(item.target, ast.Name)
        ]
    return classes


# 数着数的类型。⚠ 密钥永远不是数：`max_input_tokens: int` 里的 token 是模型
# 那个 token，与凭据没有一点关系，而只按名字判会把它当成密钥
_COUNTING = frozenset({"int", "float", "bool"})


def _numeric_fields(tree: ast.Module) -> set[tuple[str, str]]:
    """标注成数值类型的字段，按 (类名, 字段名) 索引。

    Args: tree。
    """
    found: set[tuple[str, str]] = set()
    for node in tree.body:
        if not isinstance(node, ast.ClassDef):
            continue
        for item in node.body:
            if not isinstance(item, ast.AnnAssign):
                continue
            if not isinstance(item.target, ast.Name):
                continue
            if _annotation_name(item.annotation) in _COUNTING:
                found.add((node.name, item.target.id))
    return found


def _annotation_name(node: ast.expr) -> str:
    """标注摊成一个名字；`int | None` 取 `int`，认不出给空串。

    Args: node。
    """
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
        return _annotation_name(node.left)
    return ""


def _base_names(tree: ast.Module, name: str) -> list[str]:
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == name:
            return [b.id for b in node.bases if isinstance(b, ast.Name)]
    return []


def _has_string_default(value: ast.expr | None) -> bool:
    """`= None` 是 fail-closed 的缺省，`= "dev-secret"` 才是把密钥发布出去。

    ⚠ `Field(min_length=32)` 是约束不是默认值：只有带 `default` 的才算。
    Args: value。
    """
    if value is None:
        return False
    if isinstance(value, ast.Constant):
        return value.value is not None
    if isinstance(value, ast.Call):
        named = {keyword.arg for keyword in value.keywords}
        return bool(value.args) or bool(named & {"default", "default_factory"})
    return True


def check_secrets_have_no_default() -> list[Violation]:
    """密钥类配置绝不能有默认值——未设置就该 fail-closed 拒绝启动。"""
    found: list[Violation] = []
    for path in python_sources():
        if path.name not in {"settings.py", "base.py"}:
            continue
        tree = parse(path)
        if tree is None:
            continue
        counting = _numeric_fields(tree)
        for owner, fields in _class_fields(tree).items():
            for name, value in fields:
                if not SECRET_WORDS.search(name):
                    continue
                # ⚠ 数值字段放行：`token` 这个词在 LLM 语境里是计量单位
                # （`max_input_tokens`），而密钥永远不是一个数
                if (owner, name) in counting:
                    continue
                if _has_string_default(value):
                    found.append(
                        Violation(
                            "密钥类配置不许有默认值",
                            at(path),
                            f"{name}；弱默认的密钥等于没有密钥",
                        )
                    )
    return found


def _compares_environment(node: ast.Compare) -> bool:
    left = node.left
    name = ""
    if isinstance(left, ast.Attribute):
        name = left.attr
    elif isinstance(left, ast.Name):
        name = left.id
    if name.lower().removeprefix("_") not in ENV_NAMES:
        return False
    return any(
        isinstance(other, ast.Constant)
        and isinstance(other.value, str)
        and other.value.lower() in ENV_VALUES
        for other in node.comparators
    )


def check_no_environment_branch() -> list[Violation]:
    """环境差异只能是取值，不能是行为。"""
    found: list[Violation] = []
    for path in python_sources():
        tree = parse(path)
        if tree is None:
            continue
        found.extend(
            Violation(
                "禁止按环境分支",
                at(path, node.lineno),
                "生产跑的那条分支从未被测试过；用取值差异表达",
            )
            for node in ast.walk(tree)
            if isinstance(node, ast.Compare) and _compares_environment(node)
        )
    return found


def _parameter_defaults(node: ast.arguments) -> list[tuple[str, str]]:
    positional = [*node.posonlyargs, *node.args]
    start = len(positional) - len(node.defaults)
    pairs = [
        *zip(positional[start:], node.defaults, strict=True),
        *zip(node.kwonlyargs, node.kw_defaults, strict=True),
    ]
    return [
        (argument.arg, f"{ast.unparse(argument)} = {ast.unparse(value)}")
        for argument, value in pairs
        if value is not None
    ]


def _configuration_defaults(node: ast.AST) -> list[tuple[str, str]]:
    if isinstance(node, ast.AnnAssign) and node.value is not None:
        return [(ast.unparse(node.target), ast.unparse(node))]
    if isinstance(node, ast.Assign):
        value = ast.unparse(node.value)
        names = [ast.unparse(target) for target in node.targets]
        return [(name, f"{name} = {value}") for name in names]
    if isinstance(node, ast.arguments):
        return _parameter_defaults(node)
    if isinstance(node, ast.keyword) and node.arg is not None:
        return [(node.arg, f"{node.arg} = {ast.unparse(node.value)}")]
    if isinstance(node, ast.NamedExpr):
        name = ast.unparse(node.target)
        return [(name, f"{name} = {ast.unparse(node.value)}")]
    return []


def check_no_dangerous_defaults() -> list[Violation]:
    """危险的默认值正是「看起来最方便」的那个。"""
    found: list[Violation] = []
    for path in python_sources():
        tree = parse(path)
        if tree is None:
            continue
        defaults = [
            item
            for node in ast.walk(tree)
            for item in _configuration_defaults(node)
        ]
        for pattern, reason in DANGEROUS_DEFAULTS:
            # ⚠ 规则必须起于真实目标；默认字符串中的负向夹具只是数据。
            if any(
                (match := pattern.search(text)) is not None
                and match.start() < len(target)
                for target, text in defaults
            ):
                found.append(Violation("危险的默认值", at(path), reason))
    return found


def _settings_fields(service: Path) -> tuple[str, list[str]] | None:
    """取一个服务全部配置字段名（含继承）与它的环境变量前缀。

    Args: service。
    """
    matches = sorted((service / "src").rglob("settings.py"))
    if not matches:
        return None
    tree = parse(matches[0])
    if tree is None:
        return None
    classes, bases = _settings_classes()
    classes.update(_class_fields(tree))
    bases.update(_class_bases(tree))
    return _env_prefix(tree), sorted(
        _inherited_fields("Settings", classes, bases)
    )


def _class_bases(tree: ast.Module) -> dict[str, list[str]]:
    return {
        node.name: _base_names(tree, node.name)
        for node in tree.body
        if isinstance(node, ast.ClassDef)
    }


def _settings_classes() -> (
    tuple[dict[str, list[tuple[str, ast.expr | None]]], dict[str, list[str]]]
):
    classes: dict[str, list[tuple[str, ast.expr | None]]] = {}
    bases: dict[str, list[str]] = {}
    for path in sorted(LIB_ROOT.rglob("*.py")):
        tree = parse(path)
        if tree is not None:
            classes.update(_class_fields(tree))
            bases.update(_class_bases(tree))
    return classes, bases


def _inherited_fields(
    name: str,
    classes: dict[str, list[tuple[str, ast.expr | None]]],
    bases: dict[str, list[str]],
    visited: frozenset[str] = frozenset(),
) -> set[str]:
    if name in visited:
        return set()
    names = {field for field, _ in classes.get(name, [])}
    for base in bases.get(name, []):
        names.update(_inherited_fields(base, classes, bases, visited | {name}))
    return names


def _env_prefix(tree: ast.Module) -> str:
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.keyword)
            and node.arg == "env_prefix"
            and isinstance(node.value, ast.Constant)
        ):
            return str(node.value.value)
    return ""


def check_env_example_lists_every_variable() -> list[Violation]:
    """新增一个配置项时，同一个提交里就要改模板。"""
    found: list[Violation] = []
    for service in service_dirs():
        resolved = _settings_fields(service)
        template = service / ".env.example"
        if resolved is None or not template.is_file():
            continue
        prefix, names = resolved
        documented = _template_variables(template)
        for name in names:
            variable = f"{prefix}{name}".upper()
            if variable not in documented:
                found.append(
                    Violation(
                        ".env.example 必须列出全部变量",
                        at(template),
                        variable,
                    )
                )
    return found


def compose_variables() -> dict[str, set[str]]:
    """取全部 Compose 输入变量及完整回退链，包含嵌套引用。"""
    if not COMPOSE.is_file():
        return {}
    found: dict[str, set[str]] = {}
    for item in interpolations(read(COMPOSE)):
        found.setdefault(item.name, set()).add(fallback_shape(item.fallback))
    return found


def check_fallback_chains_are_uniform() -> list[Violation]:
    """⚠ 共享值的回退链必须每个服务都写全，否则是非对称失效。"""
    return [
        Violation(
            "共享配置的回退链必须一致",
            at(COMPOSE),
            f"{name} 写了 {len(shapes)} 种回退：{sorted(shapes)}",
        )
        for name, shapes in compose_variables().items()
        if len(shapes) > 1
    ]


def check_compose_variables_are_documented() -> list[Violation]:
    """编排引用的每个变量都要在根 `.env.template` 里有一行。"""
    if not ROOT_ENV_TEMPLATE.is_file():
        return []
    documented = _template_variables(ROOT_ENV_TEMPLATE)
    return [
        Violation(
            "编排变量必须进根 .env.template",
            at(ROOT_ENV_TEMPLATE),
            name,
        )
        for name in sorted(compose_variables())
        if name not in documented
    ]


def _template_variables(path: Path) -> set[str]:
    if not path.is_file():
        return set()
    return {
        match[1]
        for line in read(path).splitlines()
        if (match := ENV_VARIABLE.match(line)) is not None
    }


def check_root_template_lists_every_variable() -> list[Violation]:
    """根模板列全各服务的 Settings 字段，包括继承与固定拓扑项。"""
    documented = _template_variables(ROOT_ENV_TEMPLATE)
    found: list[Violation] = []
    for service in service_dirs():
        resolved = _settings_fields(service)
        if resolved is None:
            continue
        prefix, names = resolved
        found.extend(
            Violation(
                "根 .env.template 必须列出全部配置",
                at(ROOT_ENV_TEMPLATE),
                variable,
            )
            for name in names
            if (variable := f"{prefix}{name}".upper()) not in documented
        )
    return found


def check_root_template_comments() -> list[Violation]:
    """每个变量的前一行都要有独立的中文说明。"""
    if not ROOT_ENV_TEMPLATE.is_file():
        return []
    lines = read(ROOT_ENV_TEMPLATE).splitlines()
    found: list[Violation] = []
    for number, line in enumerate(lines):
        match = ENV_VARIABLE.match(line)
        if match is None:
            continue
        previous = lines[number - 1].strip() if number else ""
        has_comment = (
            previous.startswith("#")
            and ENV_VARIABLE.match(previous) is None
            and CHINESE_COMMENT.search(previous) is not None
        )
        if not has_comment:
            found.append(
                Violation(
                    "环境变量需要紧邻一行中文说明",
                    at(ROOT_ENV_TEMPLATE, number + 1),
                    match[1],
                )
            )
    return found


def check_root_templates_are_synchronized() -> list[Violation]:
    """兼容入口 .env.example 与主模板 .env.template 保持逐字一致。"""
    missing = [
        Violation("根环境变量模板必须存在", at(path), path.name)
        for path in (ROOT_ENV_TEMPLATE, ROOT_ENV_EXAMPLE)
        if not path.is_file()
    ]
    if missing:
        return missing
    if read(ROOT_ENV_TEMPLATE) == read(ROOT_ENV_EXAMPLE):
        return []
    return [
        Violation(
            "根环境变量模板必须同步", at(ROOT_ENV_EXAMPLE), ".env.template"
        )
    ]


def _runtime_units(service: Path) -> tuple[str, ...]:
    if service.name == "platform-server":
        return "platform-server", "platform-worker", "platform-publisher"
    if service.name == "knowledge-server":
        return "knowledge-server", "knowledge-worker"
    return (service.name,)


def check_compose_passes_every_setting() -> list[Violation]:
    """所有可调 Settings 都要透传到每个运行角色，固定拓扑项除外。"""
    environments = compose_environments(read(COMPOSE))
    found: list[Violation] = []
    for service in service_dirs():
        resolved = _settings_fields(service)
        if resolved is None:
            continue
        prefix, names = resolved
        for unit in _runtime_units(service):
            entries = environments.get(unit, {})
            for name in names:
                if name in FIXED_COMPOSE_FIELDS:
                    continue
                variable = f"{prefix}{name}".upper()
                value = entries.get(variable)
                if value is None or (value and not list(interpolations(value))):
                    found.append(
                        Violation(
                            f"{unit} 必须透传可调配置",
                            at(COMPOSE),
                            variable,
                        )
                    )
    return found


def check_migration_credentials_are_isolated() -> list[Violation]:
    """迁移账号只给部署作业，未配置时回退应用数据库账号。"""
    found: list[Violation] = []
    for service, entries in compose_environments(read(COMPOSE)).items():
        if service == "database-migrate":
            continue
        for value in entries.values():
            found.extend(
                Violation(
                    "迁移配置只能注入 database-migrate", at(COMPOSE), item.name
                )
                for item in interpolations(value)
                if item.name.startswith("MIGRATION_")
            )
    shapes = compose_variables()
    for suffix in ("USER", "PASSWORD"):
        variable = f"MIGRATION_POSTGRES_{suffix}"
        expected = fallback_shape(f":-${{POSTGRES_{suffix}:?必填}}")
        if variable in shapes and shapes[variable] != {expected}:
            found.append(
                Violation(
                    "迁移账号必须回退普通数据库账号", at(COMPOSE), variable
                )
            )
    return found


CHECKS = (
    check_secrets_have_no_default,
    check_no_environment_branch,
    check_no_dangerous_defaults,
    check_env_example_lists_every_variable,
    check_fallback_chains_are_uniform,
    check_compose_variables_are_documented,
    check_root_template_lists_every_variable,
    check_root_template_comments,
    check_root_templates_are_synchronized,
    check_compose_passes_every_setting,
    check_migration_credentials_are_isolated,
)


if __name__ == "__main__":
    raise SystemExit(main("配置与密钥检查", CHECKS))
