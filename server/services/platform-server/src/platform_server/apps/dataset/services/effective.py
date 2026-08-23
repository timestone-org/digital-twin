"""台账的取值口径：一格实际生效的值到底取的是哪一个。

`effective(k) = overrides[k].v 若存在，否则 values[k]`——**只有这一份实现**
（docs/DATASET_DESIGN.md D4）。记录分页 / 最新值 / 序列 / 公式求值全部走它，
出参里的 `values` 因此已经是 effective，前端不必也不该再叠一遍。
"""

from typing import Any, cast

from platform_server.apps.dataset.formula import RowSnapshot
from platform_server.apps.dataset.models import DatasetRecord

# 一条修正记录里装着修正值的那个键。⚠ 落库形态是 `{v, by, by_name, at, reason?}`
# （§4.2），对外形态里它叫 `value`——两处名字不同，故只在这里出现一次
OVERRIDE_VALUE_KEY = "v"


def apply_overrides(
    values: dict[str, Any] | None, overrides: dict[str, Any] | None
) -> dict[str, Any]:
    """原值叠上人工修正。取值口径的唯一实现。

    ⚠ 修正条目缺 `v` 或 `v` 为空时**退回原值**，不把这一格显示成空：撤销修正
    走的是删条目，留一个空的 `v` 不是任何一条正常写入路径的产物，只可能是有人
    直接改了库。
    Args: values, overrides。
    """
    merged = dict(values or {})
    if not isinstance(overrides, dict):
        return merged
    for key, entry in overrides.items():
        found = _override_value(entry)
        if found is not None:
            merged[key] = found
    return merged


def _override_value(entry: Any) -> Any:
    """一条修正记录里的修正值；不是完整条目就当没有。

    Args: entry。
    """
    if not isinstance(entry, dict):
        return None
    return cast("dict[str, Any]", entry).get(OVERRIDE_VALUE_KEY)


def effective_values(record: DatasetRecord) -> dict[str, Any]:
    """一行的生效原值：人工修正优先于采集/录入值。

    Args: record。
    """
    return apply_overrides(record.values_json, record.overrides_json)


def effective_merged(record: DatasetRecord) -> dict[str, Any]:
    """一行的完整可读值：生效原值打底、公式结果覆盖同名键。

    ⚠ 公式列**算出空也算数**：`computed_json` 里有这个键就以公式为准，不回落
    到原值——一列从录入列改成公式列之后，`values_json` 里的旧值还留着，回落会
    让它借尸还魂。
    Args: record。
    """
    return {**effective_values(record), **(record.computed_json or {})}


def to_snapshot(record: DatasetRecord) -> RowSnapshot:
    """一行在求值视角下的样子。

    ⚠ `PREV` / 时间窗 / 跨表引用取到的历史行全经这里，故它们与同行取值天然
    同口径：换一处自己拼一遍，同一列会在「本行」与「PREV 里的本行」取到两个数。
    Args: record。
    """
    return RowSnapshot(ts=record.ts, values=effective_merged(record))
