"""录入值的清洗与写入三分派：公式列拒收、录入列落原值、点位列落人工修正。

分派表见 docs/DATASET_DESIGN.md §8.4。⚠ 点位汇总列**只认显式提交的 key**：
不套默认值、不参与必填校验，显式提交为空 = 撤销那一格的修正——「提交为空」与
「改成空」是两件事，混成一件用户就会撤了一格却看到「已修正 1 格」。
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from lib.errors.base import FieldError
from lib.utils.timeutils import format_rfc3339, utcnow
from platform_server.apps.dataset.errors import DatasetRecordInvalid
from platform_server.apps.dataset.models import DatasetColumn
from platform_server.apps.dataset.services.effective import (
    OVERRIDE_VALUE_KEY,
    apply_overrides,
)

# 布尔列认得的两组写法。CSV 与表单都可能送上来这些串
_TRUE_WORDS = frozenset({"true", "1", "yes", "on", "是"})
_FALSE_WORDS = frozenset({"false", "0", "no", "off", "否"})


@dataclass(frozen=True)
class Actor:
    """一次人工修正的责任人：用户 id + 用户名。

    ⚠ 用户名冗余带一份是刻意的：账号可能被删，按 id 反查会得到空，而这一格
    要一直答得出「谁改的」。
    """

    user_id: str | None = None
    name: str | None = None


@dataclass(frozen=True)
class SanitizedValues:
    """一次提交清洗之后的四份产物。"""

    #: 落 `values_json` 的人工录入列值
    values: dict[str, Any] = field(default_factory=dict[str, Any])
    #: 落 `overrides_json` 的人工修正条目
    overrides: dict[str, Any] = field(default_factory=dict[str, Any])
    #: 本次显式提交为空的点位汇总列——它们的既有修正要被删掉
    cleared: frozenset[str] = frozenset()
    #: 本次**显式提交**的人工录入列。⚠ 与「补出来的默认值」分开：只有它们
    #: 才该覆盖既有原值，否则一次只改一列的编辑会把别的列一起重置成默认值
    submitted: frozenset[str] = frozenset()

    @property
    def effective(self) -> dict[str, Any]:
        """按取值口径合成的一行值——喂给公式求值的就是它。"""
        return apply_overrides(self.values, self.overrides)


def sanitize(
    raw: dict[str, Any],
    columns: Sequence[DatasetColumn],
    *,
    actor: Actor,
    reason: str | None = None,
    is_strict: bool = True,
) -> SanitizedValues:
    """把提交上来的一行值按列的 `source` 三分派。未定义的列 key 一律丢弃。

    Args: raw, columns, actor, reason, is_strict（False 跳过必填校验）。
    """
    values, submitted = _entered(raw, columns)
    overrides, cleared = _corrected(raw, columns, actor=actor, reason=reason)
    if is_strict:
        _require_filled(values, columns)
    return SanitizedValues(
        values=values,
        overrides=overrides,
        cleared=frozenset(cleared),
        submitted=frozenset(submitted),
    )


def make_override(
    value: Any, *, actor: Actor, reason: str | None, at: datetime
) -> dict[str, Any]:
    """构造一条修正记录。落库形态见 docs/DATASET_DESIGN.md §4.2。

    Args: value, actor, reason, at。
    """
    entry: dict[str, Any] = {
        OVERRIDE_VALUE_KEY: value,
        "by": actor.user_id,
        "by_name": actor.name,
        "at": format_rfc3339(at),
    }
    if reason:
        entry["reason"] = reason
    return entry


def merge_values(
    existing: dict[str, Any] | None, sanitized: SanitizedValues
) -> dict[str, Any]:
    """既有原值 + 本次提交：只覆盖显式提交过的那几个录入列。

    ⚠ 整体覆盖会抹掉点位汇总列的采集原值与已删列的残值（§4.3a）：前者让这一行
    的自动值凭空消失，后者让「把列加回来」再也找不回历史。
    Args: existing, sanitized。
    """
    merged = dict(existing or {})
    for key in sanitized.submitted:
        merged[key] = sanitized.values.get(key)
    return merged


def merge_overrides(
    existing: dict[str, Any] | None, sanitized: SanitizedValues
) -> dict[str, Any]:
    """既有修正 + 本次提交：显式提交为空的那几列删掉修正，其余保留。

    Args: existing, sanitized。
    """
    merged = {
        key: entry
        for key, entry in (existing or {}).items()
        if key not in sanitized.cleared
    }
    merged.update(sanitized.overrides)
    return merged


def coerce(value: Any, column: DatasetColumn) -> Any:
    """按列的 `data_type` 归一一个值。空白串一律视作空值。

    Args: value, column。
    """
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None
    if column.data_type == "number":
        return _as_number(value, column)
    if column.data_type == "bool":
        return _as_bool(value, column)
    return str(value)


def rejected(column_key: str, message: str) -> DatasetRecordInvalid:
    """把一条值错误标到它所属的那一格上。

    Args: column_key, message。
    """
    return DatasetRecordInvalid(
        message,
        details=(
            FieldError(
                field=f"values[{column_key}]",
                code="invalid_value",
                message=message,
            ),
        ),
    )


def _entered(
    raw: dict[str, Any], columns: Sequence[DatasetColumn]
) -> tuple[dict[str, Any], list[str]]:
    """人工录入列：提交了就用提交的，没提交就取默认值，再没有就空。

    Args: raw, columns。
    """
    values: dict[str, Any] = {}
    submitted: list[str] = []
    for column in columns:
        if column.source != "manual":
            continue
        if column.key in raw:
            values[column.key] = coerce(raw[column.key], column)
            submitted.append(column.key)
        elif column.default_value is not None:
            values[column.key] = coerce(column.default_value, column)
        else:
            values[column.key] = None
    return values, submitted


def _corrected(
    raw: dict[str, Any],
    columns: Sequence[DatasetColumn],
    *,
    actor: Actor,
    reason: str | None,
) -> tuple[dict[str, Any], list[str]]:
    """点位汇总列：提交的值走人工修正通道，提交为空是撤销。

    Args: raw, columns, actor, reason。
    """
    moment = utcnow()
    overrides: dict[str, Any] = {}
    cleared: list[str] = []
    for column in columns:
        if column.source != "point" or column.key not in raw:
            continue
        value = coerce(raw[column.key], column)
        if value is None:
            cleared.append(column.key)
            continue
        overrides[column.key] = make_override(
            value, actor=actor, reason=reason, at=moment
        )
    return overrides, cleared


def _require_filled(
    values: dict[str, Any], columns: Sequence[DatasetColumn]
) -> None:
    """必填的人工录入列一个都不许空。

    Args: values, columns。
    """
    missing = [
        column
        for column in columns
        if column.source == "manual"
        and column.is_required
        and values.get(column.key) is None
    ]
    if not missing:
        return
    names = "、".join(column.name for column in missing)
    raise DatasetRecordInvalid(
        f"必填列未填写：{names}",
        details=tuple(
            FieldError(
                field=f"values[{column.key}]",
                code="value_required",
                message=f"「{column.name}」是必填列",
            )
            for column in missing
        ),
    )


def _as_number(value: Any, column: DatasetColumn) -> float:
    """把一个值归一成数。

    ⚠ 三类失败都要接住：任意精度整数走 `float()` 抛的是 OverflowError，
    而 inf / NaN 会被 `json.dumps` 写成 `Infinity` / `NaN`，PG 的 jsonb 直接
    拒收——整行录入于是失败在一条与用户输入毫不相干的报错上。
    Args: value, column。
    """
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise rejected(
            column.key, f"列「{column.name}」需要数字，收到 {value!r}"
        ) from error
    except OverflowError as error:
        raise rejected(
            column.key, f"列「{column.name}」的数值超出可表示范围"
        ) from error
    if math.isnan(number) or math.isinf(number):
        raise rejected(column.key, f"列「{column.name}」的数值超出可表示范围")
    return number


def _as_bool(value: Any, column: DatasetColumn) -> bool:
    """把一个值归一成真假。

    Args: value, column。
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, int | float):
        return value != 0
    text = str(value).strip().lower()
    if text in _TRUE_WORDS:
        return True
    if text in _FALSE_WORDS:
        return False
    raise rejected(column.key, f"列「{column.name}」需要布尔值，收到 {value!r}")
