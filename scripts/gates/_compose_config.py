"""Compose 配置解析：保留嵌套回退语义，并展开环境变量映射锚点。"""

from __future__ import annotations

import re
from collections.abc import Iterator
from dataclasses import dataclass

COMPOSE_VARIABLE_NAME = re.compile(r"^([A-Z][A-Z0-9_]*)(.*)$", re.S)
ANCHOR = re.compile(r"^x-[a-z0-9-]+:\s*&([a-z0-9-]+)\s*$")
SERVICE = re.compile(r"^  ([a-z0-9-]+):\s*$")
ENVIRONMENT_KEY = re.compile(r"^([A-Z][A-Z0-9_]*):\s*(.*)$")
MERGE_ANCHOR = re.compile(r"\*([a-z0-9-]+)")


@dataclass(frozen=True)
class Interpolation:
    """一个完整 Compose 插值及其在原文中的边界。"""

    start: int
    end: int
    name: str
    fallback: str


def _interpolation_end(text: str, start: int) -> int:
    depth = 1
    cursor = start + 2
    while cursor < len(text):
        if text.startswith("${", cursor):
            depth += 1
            cursor += 2
            continue
        if text[cursor] == "}":
            depth -= 1
            if not depth:
                return cursor + 1
        cursor += 1
    return len(text)


def _interpolation_spans(text: str) -> Iterator[Interpolation]:
    cursor = 0
    while (start := text.find("${", cursor)) != -1:
        end = _interpolation_end(text, start)
        cursor = end
        dollars = len(text[:start]) - len(text[:start].rstrip("$"))
        if dollars % 2:
            continue
        match = COMPOSE_VARIABLE_NAME.fullmatch(text[start + 2 : end - 1])
        if match is not None:
            yield Interpolation(start, end, match[1], match[2])


def interpolations(text: str) -> Iterator[Interpolation]:
    for item in _interpolation_spans(text):
        yield item
        yield from interpolations(item.fallback)


def _canonical_fallback(text: str) -> str:
    pieces: list[str] = []
    cursor = 0
    for item in _interpolation_spans(text):
        pieces.append(text[cursor : item.start])
        pieces.append(f"${{{item.name}|{fallback_shape(item.fallback)}}}")
        cursor = item.end
    pieces.append(text[cursor:])
    return "".join(pieces)


def fallback_shape(raw: str | None) -> str:
    """把 `${K:?说明}` 归一成语义形态——提示文案不同不算回退链分叉。

    Args: raw。
    """
    if not raw:
        return "直取"
    if raw.startswith(":?"):
        return "必填（空或未设置）"
    if raw.startswith("?"):
        return "必填（未设置）"
    operator = raw[:2] if raw.startswith(":") else raw[:1]
    return f"{operator}{_canonical_fallback(raw[len(operator):])}"


def _mapping_entries(
    lines: list[str], start: int, indent: int
) -> dict[str, str]:
    entries: dict[str, str] = {}
    for line in lines[start:]:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        depth = len(line) - len(line.lstrip())
        if depth < indent:
            break
        if depth != indent:
            continue
        raw = line.strip()
        match = ENVIRONMENT_KEY.fullmatch(raw)
        if match is not None:
            entries[match[1]] = match[2]
        elif raw.startswith("<<:"):
            entries["<<"] = raw.removeprefix("<<:").strip()
    return entries


def _raw_environments(
    text: str,
) -> tuple[dict[str, dict[str, str]], dict[str, dict[str, str]]]:
    anchors: dict[str, dict[str, str]] = {}
    environments: dict[str, dict[str, str]] = {}
    lines = text.splitlines()
    service = ""
    for number, line in enumerate(lines):
        anchor = ANCHOR.fullmatch(line)
        if anchor is not None:
            anchors[anchor[1]] = _mapping_entries(lines, number + 1, 2)
        owner = SERVICE.fullmatch(line)
        if owner is not None:
            service = owner[1]
        if service and line.startswith("    environment:"):
            environments[service] = _mapping_entries(lines, number + 1, 6)
    return anchors, environments


def _resolved_environment(
    entries: dict[str, str],
    anchors: dict[str, dict[str, str]],
    visited: frozenset[str] = frozenset(),
) -> dict[str, str]:
    inherited: dict[str, str] = {}
    names = MERGE_ANCHOR.findall(entries.get("<<", ""))
    for name in reversed(names):
        if name not in visited:
            inherited.update(
                _resolved_environment(
                    anchors.get(name, {}), anchors, visited | {name}
                )
            )
    inherited.update(
        {key: value for key, value in entries.items() if key != "<<"}
    )
    return inherited


def compose_environments(text: str) -> dict[str, dict[str, str]]:
    anchors, environments = _raw_environments(text)
    return {
        service: _resolved_environment(entries, anchors)
        for service, entries in environments.items()
    }
