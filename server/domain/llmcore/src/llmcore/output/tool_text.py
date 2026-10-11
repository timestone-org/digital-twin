"""把工具结果排成有明确省略边界的紧凑文本。"""

import json
import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from decimal import Decimal
from typing import cast

_MAX_DEPTH: int = 12
_MIN_TABLE_ROWS: int = 2
_DEPTH_NOTE: str = "…（嵌套深度超限，内容已省略）"
_SHORT_NOTICE: str = "…（已截断）"
_VALUE_NOTICE: str = "…（完整值超出预算，已省略）"
_UNSAFE_INLINE: frozenset[str] = frozenset("|`\n\r<>[]*&\\")
_PRIORITY_FIELDS: frozenset[str] = frozenset(
    {
        "total",
        "has_more",
        "next_page",
        "next_cursor",
        "warnings",
        "is_stale",
        "errors",
        "error",
        "success",
        "code",
        "message",
    }
)


@dataclass
class _TextBudget:
    limit: int
    lines: list[str] = field(default_factory=list[str])
    used: int = 0
    omitted_items: int = 0
    omitted_fields: int = 0
    has_truncation: bool = False

    def append(self, text: str) -> bool:
        added = len(text) + bool(self.lines)
        if self.used + added > self.limit:
            self.has_truncation = True
            return False
        self.lines.append(text)
        self.used += added
        return True

    def render(self) -> str:
        return "\n".join(self.lines)

    def remaining(self) -> int:
        return max(0, self.limit - self.used - bool(self.lines))


def format_tool_output(value: object, max_chars: int = 20000) -> str:
    """在字符预算内排版工具回执。Args: value, max_chars。"""
    if max_chars <= 0:
        return ""
    if isinstance(value, str):
        return _truncate_text(value, max_chars)
    budget = _render_document(value, max_chars)
    if not budget.has_truncation:
        return budget.render()
    notice = _build_notice(budget)
    reserved = len(notice) + 1
    while reserved < max_chars:
        budget = _render_document(value, max_chars - reserved)
        notice = _build_notice(budget)
        if len(notice) + 1 <= reserved:
            return "\n".join(part for part in (budget.render(), notice) if part)
        reserved = len(notice) + 1
    return _SHORT_NOTICE[:max_chars]


def _render_document(value: object, limit: int) -> _TextBudget:
    budget = _TextBudget(limit)
    _render_value(value, budget, 0)
    return budget


def _build_notice(budget: _TextBudget) -> str:
    counts: list[str] = []
    if budget.omitted_items:
        counts.append(f"省略 {budget.omitted_items} 项")
    if budget.omitted_fields:
        counts.append(f"省略 {budget.omitted_fields} 个字段")
    detail = f"，{'、'.join(counts)}" if counts else ""
    return f"…（已截断{detail}；请缩小筛选范围，如有分页信息可继续获取。）"


def _render_value(value: object, budget: _TextBudget, depth: int) -> None:
    if depth >= _MAX_DEPTH:
        budget.append(_DEPTH_NOTE)
        budget.has_truncation = True
    elif isinstance(value, Mapping):
        _render_mapping(cast(Mapping[object, object], value), budget, depth)
    elif _is_sequence(value):
        _render_sequence(cast(Sequence[object], value), budget, depth)
    else:
        _write_scalar("", value, budget)


def _render_mapping(
    values: Mapping[object, object], budget: _TextBudget, depth: int
) -> None:
    if not values:
        budget.append("{}")
        return
    for key, value in sorted(values.items(), key=_rank_field):
        label = f"{'  ' * depth}{_format_key(str(key))}:"
        if _is_mapping(value) and value:
            if budget.append(label):
                _render_value(value, budget, depth + 1)
            else:
                budget.omitted_fields += 1
        elif _is_sequence(value) and value:
            if budget.append(label):
                _render_value(value, budget, depth + 1)
            else:
                budget.omitted_items += len(cast(Sequence[object], value))
        else:
            _write_scalar(label, value, budget, _is_identity_field(str(key)))


def _rank_field(item: tuple[object, object]) -> tuple[int, int]:
    key, value = item
    is_priority = str(key).casefold() in _PRIORITY_FIELDS
    if is_priority:
        return (
            int(_is_sequence(value)),
            len(value) if isinstance(value, str) else 0,
        )
    if isinstance(value, Mapping):
        return (3, 0)
    if _is_sequence(value):
        return (5, 0)
    if isinstance(value, str):
        return (4 if "\n" in value else 2, len(value))
    return (2, 0)


def _write_scalar(
    label: str, value: object, budget: _TextBudget, is_identity: bool = False
) -> None:
    if isinstance(value, str) and "\n" in value:
        _write_multiline(label, value, budget, is_identity)
        return
    text, has_truncation = _format_inline(value, budget.limit, 0)
    if not _is_inline_safe(text) and value:
        _write_multiline(label, text, budget, is_identity)
        return
    has_code = isinstance(value, str) and "_" in value
    prefix = f"{label} " if label else ""
    available = budget.remaining() - len(prefix) - int(has_code) * 2
    if is_identity and len(text) > available:
        _write_omitted_value(label, budget)
        return
    if available < len(_SHORT_NOTICE) and len(text) > available:
        budget.omitted_fields += 1
        budget.has_truncation = True
        return
    clipped = _truncate_text(text, available)
    budget.has_truncation |= has_truncation or clipped != text
    budget.append(prefix + (f"`{clipped}`" if has_code else clipped))


def _write_multiline(
    label: str, value: str, budget: _TextBudget, is_identity: bool = False
) -> None:
    runs = re.findall(r"`+", value)
    fence = "`" * max(3, max((len(run) + 1 for run in runs), default=3))
    prefix = f"{label}\n{fence}\n" if label else f"{fence}\n"
    suffix = f"\n{fence}"
    available = budget.remaining() - len(prefix) - len(suffix)
    if is_identity and len(value) > available:
        _write_omitted_value(label, budget)
        return
    if available < len(_SHORT_NOTICE):
        budget.has_truncation = True
        budget.omitted_fields += 1
        return
    clipped = _truncate_text(value, available)
    budget.has_truncation |= clipped != value
    budget.append(prefix + clipped + suffix)


def _render_sequence(
    values: Sequence[object], budget: _TextBudget, depth: int
) -> None:
    if not values:
        budget.append("[]")
        return
    columns = _resolve_columns(values)
    if columns:
        header = (
            "| "
            + " | ".join(f"`{key}`" if "_" in key else key for key in columns)
            + " |"
        )
        divider = "| " + " | ".join("---" for _ in columns) + " |"
        if not budget.append(header + "\n" + divider):
            budget.omitted_items += len(values)
            return
    for index, value in enumerate(values):
        text, has_truncation = _format_row(value, columns, budget.limit, depth)
        if _is_mapping(value) and not columns:
            text = f"记录 {index + 1}:\n{text}"
        if not budget.append(text):
            budget.omitted_items += len(values) - index
            return
        budget.has_truncation |= has_truncation


def _resolve_columns(values: Sequence[object]) -> tuple[str, ...]:
    first = values[0]
    if len(values) < _MIN_TABLE_ROWS or not _is_mapping(first) or not first:
        return ()
    first_values = cast(Mapping[object, object], first)
    if not all(isinstance(key, str) for key in first_values):
        return ()
    columns = tuple(str(key) for key in first_values)
    if not all(_is_inline_safe(key) for key in columns):
        return ()
    keys = set(first_values)
    for value in values:
        if not isinstance(value, Mapping):
            return ()
        row = cast(Mapping[object, object], value)
        if set(row) != keys or not all(
            _is_table_cell(cell) for cell in row.values()
        ):
            return ()
    return columns


def _format_row(
    value: object, columns: tuple[str, ...], limit: int, depth: int
) -> tuple[str, bool]:
    if not columns:
        if _is_mapping(value):
            nested_budget = _TextBudget(limit)
            _render_value(value, nested_budget, depth + 1)
            return nested_budget.render(), nested_budget.has_truncation
        text, has_truncation = _format_inline(value, limit, depth + 1)
        if not _is_inline_safe(text):
            nested_budget = _TextBudget(limit)
            _write_scalar("", value, nested_budget)
            return nested_budget.render(), nested_budget.has_truncation
        return f"- {text}", has_truncation
    values = cast(Mapping[object, object], value)
    cells = [
        _format_inline(values[column], limit, depth + 1) for column in columns
    ]
    cells = [
        (f"`{text}`" if isinstance(values[column], str) else text, is_clipped)
        for column, (text, is_clipped) in zip(columns, cells, strict=True)
    ]
    return (
        "| " + " | ".join(text for text, _ in cells) + " |",
        any(has_truncation for _, has_truncation in cells),
    )


def _format_inline(value: object, limit: int, depth: int) -> tuple[str, bool]:
    if depth >= _MAX_DEPTH:
        return _DEPTH_NOTE, True
    if isinstance(value, Mapping):
        values = cast(Mapping[object, object], value)
        parts = (
            (_format_key(str(key)) + "=", cell) for key, cell in values.items()
        )
        return _join_inline(parts, len(values), limit, depth, ("{", "}"))
    if _is_sequence(value):
        values = cast(Sequence[object], value)
        parts = (("", cell) for cell in values)
        return _join_inline(parts, len(values), limit, depth, ("[", "]"))
    return _format_scalar(value), False


def _join_inline(
    parts: Iterable[tuple[str, object]],
    count: int,
    limit: int,
    depth: int,
    brackets: tuple[str, str],
) -> tuple[str, bool]:
    texts: list[str] = []
    has_truncation = False
    used = 2
    for index, (prefix, value) in enumerate(parts):
        text, is_clipped = _format_inline(value, limit, depth + 1)
        text = prefix + text
        if used + len(text) + bool(texts) * 2 > limit:
            texts.append(f"…（省略 {count - index} 项）")
            has_truncation = True
            break
        texts.append(text)
        used += len(text) + bool(index) * 2
        has_truncation |= is_clipped
    return brackets[0] + "; ".join(texts) + brackets[1], has_truncation


def _format_scalar(value: object) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int | float | Decimal):
        return str(value)
    return json.dumps(str(value), ensure_ascii=False)


def _format_key(value: str) -> str:
    encoded = json.dumps(value, ensure_ascii=False)[1:-1]
    if _is_inline_safe(encoded) and encoded.count("_") <= 1:
        return encoded
    runs = re.findall(r"`+", encoded)
    delimiter = "`" * max((len(run) + 1 for run in runs), default=1)
    return f"{delimiter}{encoded}{delimiter}"


def _is_inline_safe(value: str) -> bool:
    return not _UNSAFE_INLINE.intersection(value)


def _is_table_cell(value: object) -> bool:
    return (
        not _is_mapping(value)
        and not _is_sequence(value)
        and _is_inline_safe(_format_scalar(value))
    )


def _is_identity_field(key: str) -> bool:
    normalized = key.casefold()
    return normalized in {
        "id",
        "ref",
        "cursor",
        "node_key",
    } or normalized.endswith(("_id", "_key", "_ref", "_cursor"))


def _write_omitted_value(label: str, budget: _TextBudget) -> None:
    budget.has_truncation = True
    budget.omitted_fields += 1
    budget.append(f"{label} {_VALUE_NOTICE}")


def _truncate_text(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    if limit <= len(_SHORT_NOTICE):
        return _SHORT_NOTICE[: max(0, limit)]
    return text[: limit - len(_SHORT_NOTICE)] + _SHORT_NOTICE


def _is_sequence(value: object) -> bool:
    return isinstance(value, Sequence) and not isinstance(value, str | bytes)


def _is_mapping(value: object) -> bool:
    return isinstance(value, Mapping)
