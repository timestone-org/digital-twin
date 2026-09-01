#!/usr/bin/env python3
"""配置与密钥闸：config-and-secrets.md §3–§6、§8。

弱默认的密钥等于没有密钥；回退链少写一处就是非对称失效；而模板漏一项，
下一个部署的人会撞上一个没有文档的启动失败。
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

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
COMPOSE_VAR = re.compile(
    r"\$\{(?P<name>[A-Z0-9_]+)(?P<fallback>[:\-?][^}]*)?\}"
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
        for fields in _class_fields(tree).values():
            for name, value in fields:
                if not SECRET_WORDS.search(name):
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


def check_no_dangerous_defaults() -> list[Violation]:
    """危险的默认值正是「看起来最方便」的那个。"""
    found: list[Violation] = []
    for path in python_sources():
        text = read(path)
        for pattern, reason in DANGEROUS_DEFAULTS:
            if pattern.search(text):
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
    own = _class_fields(tree)
    shared = _lib_class_fields()
    names = [name for name, _ in own.get("Settings", [])]
    for base in _base_names(tree, "Settings"):
        names.extend(name for name, _ in shared.get(base, []))
    return _env_prefix(tree), sorted(set(names))


def _lib_class_fields() -> dict[str, list[tuple[str, ast.expr | None]]]:
    """lib 里全部配置组的字段，按类名索引。

    ⚠ 不能只读 base.py：服务的 Settings 会继承别处的组（如
    `lib.objectstore.ObjectStoreSettings`），漏掉那些文件等于那一组字段
    对本闸隐形——模板少了几行也照样绿。
    """
    shared: dict[str, list[tuple[str, ast.expr | None]]] = {}
    for path in sorted(LIB_ROOT.rglob("*.py")):
        tree = parse(path)
        if tree is not None:
            shared.update(_class_fields(tree))
    return shared


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
        text = read(template)
        for name in names:
            variable = f"{prefix}{name}".upper()
            if f"{variable}=" not in text:
                found.append(
                    Violation(
                        ".env.example 必须列出全部变量",
                        at(template),
                        variable,
                    )
                )
    return found


def _fallback_shape(raw: str | None) -> str:
    """把 `${K:?说明}` 归一成语义形态——提示文案不同不算回退链分叉。

    Args: raw。
    """
    if not raw:
        return "直取"
    if raw.startswith((":?", "?")):
        return "必填"
    return f"默认={raw.lstrip(':-')}"


def _compose_variables() -> dict[str, set[str]]:
    if not COMPOSE.is_file():
        return {}
    found: dict[str, set[str]] = {}
    for match in COMPOSE_VAR.finditer(read(COMPOSE)):
        name = match.group("name")
        shape = _fallback_shape(match.group("fallback"))
        found.setdefault(name, set()).add(shape)
    return found


def check_fallback_chains_are_uniform() -> list[Violation]:
    """⚠ 共享值的回退链必须每个服务都写全，否则是非对称失效。"""
    return [
        Violation(
            "共享配置的回退链必须一致",
            at(COMPOSE),
            f"{name} 写了 {len(shapes)} 种回退：{sorted(shapes)}",
        )
        for name, shapes in _compose_variables().items()
        if len(shapes) > 1
    ]


def check_compose_variables_are_documented() -> list[Violation]:
    """编排引用的每个变量都要在根 `.env.example` 里有一行。"""
    if not ROOT_ENV_EXAMPLE.is_file():
        return []
    text = read(ROOT_ENV_EXAMPLE)
    return [
        Violation(
            "编排变量必须进根 .env.example",
            at(ROOT_ENV_EXAMPLE),
            name,
        )
        for name in sorted(_compose_variables())
        if f"{name}=" not in text
    ]


CHECKS = (
    check_secrets_have_no_default,
    check_no_environment_branch,
    check_no_dangerous_defaults,
    check_env_example_lists_every_variable,
    check_fallback_chains_are_uniform,
    check_compose_variables_are_documented,
)


if __name__ == "__main__":
    raise SystemExit(main("配置与密钥检查", CHECKS))
