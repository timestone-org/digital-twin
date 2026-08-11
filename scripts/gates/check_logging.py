#!/usr/bin/env python3
"""可观测性闸：observability.md §2.2、§2.4、§4.2、§5。

拼变量的 `event` 会让同一类事件有无数种写法，无法聚合也无法建告警；
写进日志的密钥等于泄漏的密钥；而 liveness 查依赖是经典的自毁设计。
"""

from __future__ import annotations

import ast
from pathlib import Path

from _report import Violation, at, functions, main, parse, python_sources

LOG_METHODS = frozenset(
    {"debug", "info", "warning", "warn", "error", "critical"}
)
# 日志会被复制到多处，写进去就删不掉了
SENSITIVE = frozenset(
    {
        "password",
        "passwd",
        "pwd",
        "secret",
        "token",
        "access_token",
        "refresh_token",
        "jwt",
        "api_key",
        "apikey",
        "authorization",
        "credential",
        "credentials",
        "private_key",
        "dsn",
        "connection_string",
        "phone",
        "mobile",
        "email",
        "id_card",
        "ssn",
    }
)
# 请求体全文有长度上限，只记必要字段
BULK_FIELDS = frozenset({"body", "request_body", "response_body", "raw"})
LIVENESS_NAMES = frozenset({"health", "healthz", "liveness", "live"})
# liveness 只回答「进程没死锁、没卡住」
DEPENDENCY_HINTS = frozenset(
    {"session", "redis", "cache", "engine", "execute", "pool", "probe", "db"}
)
STREAM_WRITES = frozenset({"xadd", "publish", "lpush", "rpush"})


def _log_calls(tree: ast.Module) -> list[ast.Call]:
    """收集本模块里对日志器的调用。收窄到名字里带 log 的接收者，避免误伤。

    Args: tree。
    """
    found: list[ast.Call] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        target = node.func
        if not isinstance(target, ast.Attribute):
            continue
        if target.attr not in LOG_METHODS:
            continue
        receiver = target.value
        name = receiver.id if isinstance(receiver, ast.Name) else ""
        if "log" in name.lower():
            found.append(node)
    return found


def check_event_is_a_literal() -> list[Violation]:
    """`event` 必须是稳定字面量，不许拼接变量。"""
    found: list[Violation] = []
    for path in python_sources():
        tree = parse(path)
        if tree is None:
            continue
        for call in _log_calls(tree):
            if not call.args:
                continue
            event = call.args[0]
            if isinstance(event, ast.Constant) and isinstance(event.value, str):
                continue
            found.append(
                Violation(
                    "日志 event 必须是稳定字面量",
                    at(path, call.lineno),
                    '可变部分进字段：event="login_failed", user_id=…',
                )
            )
    return found


def check_no_secrets_in_logs() -> list[Violation]:
    """密钥、PII 与请求体全文一律不进日志。"""
    found: list[Violation] = []
    for path in python_sources():
        tree = parse(path)
        if tree is None:
            continue
        for call in _log_calls(tree):
            found.extend(_sensitive_fields(path, call))
    return found


def _sensitive_fields(path: Path, call: ast.Call) -> list[Violation]:
    found: list[Violation] = []
    for keyword in call.keywords:
        name = (keyword.arg or "").lower()
        if name in SENSITIVE:
            found.append(
                Violation(
                    "密钥与 PII 不许进日志",
                    at(path, call.lineno),
                    f"{name}；记指纹或内部 id",
                )
            )
        elif name in BULK_FIELDS:
            found.append(
                Violation(
                    "请求体全文不许进日志",
                    at(path, call.lineno),
                    f"{name}；只记必要字段并设长度上限",
                )
            )
    return found


def check_liveness_touches_nothing() -> list[Violation]:
    """⚠ liveness 查依赖会让依赖抖动引发全副本重启风暴。"""
    found: list[Violation] = []
    for path in python_sources():
        tree = parse(path)
        if tree is None:
            continue
        for node in functions(tree):
            if node.name.lower() not in LIVENESS_NAMES:
                continue
            found.extend(_dependency_reads(path, node))
    return found


def _dependency_reads(path: Path, node: ast.AST) -> list[Violation]:
    hits: set[str] = set()
    for child in ast.walk(node):
        if isinstance(child, ast.Await):
            hits.add("await")
        elif (
            isinstance(child, ast.Name) and child.id.lower() in DEPENDENCY_HINTS
        ):
            hits.add(child.id)
        elif (
            isinstance(child, ast.Attribute) and child.attr in DEPENDENCY_HINTS
        ):
            hits.add(child.attr)
    if not hits:
        return []
    return [
        Violation(
            "liveness 不许查依赖",
            at(path, getattr(node, "lineno", 0)),
            f"{'、'.join(sorted(hits))}；就绪判断放 /ready",
        )
    ]


def check_queue_envelope_carries_traceparent() -> list[Violation]:
    """⚠ 队列不会自动传播 trace：信封里漏了 traceparent，链路在异步处齐断。"""
    found: list[Violation] = []
    for path in python_sources():
        tree = parse(path)
        if tree is None:
            continue
        for node in functions(tree):
            if not _writes_to_stream(node):
                continue
            if "traceparent" in ast.dump(node):
                continue
            found.append(
                Violation(
                    "队列消息信封必须带 traceparent",
                    at(path, node.lineno),
                    f"{node.name} 投递消息但未带 traceparent",
                )
            )
    return found


def _writes_to_stream(node: ast.AST) -> bool:
    for child in ast.walk(node):
        if not isinstance(child, ast.Call):
            continue
        target = child.func
        if isinstance(target, ast.Attribute) and target.attr in STREAM_WRITES:
            return True
    return False


CHECKS = (
    check_event_is_a_literal,
    check_no_secrets_in_logs,
    check_liveness_touches_nothing,
    check_queue_envelope_carries_traceparent,
)


if __name__ == "__main__":
    raise SystemExit(main("可观测性检查", CHECKS))
