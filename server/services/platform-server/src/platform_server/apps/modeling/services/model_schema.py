"""模型 schema：一份面向**人与第三方系统**的输入输出说明。

它是可服务表示的**人话投影**——说清「要喂什么、可以不喂什么、喂什么范围合理」。
⚠ **不参与任何计算**：推理只读 `serving_json`。两份对不上时错的是 schema
（展示会不准），而不是预测值（会算错）。别图省事从这里读列名
（docs/MODELING_PLATFORM_DESIGN.md D6）。
"""

from typing import Any

from platform_server.apps.modeling.operators import registry
from platform_server.apps.modeling.services.jsonshape import (
    as_dict,
    as_text,
    as_texts,
)

# 这份说明的线形版本。加字段不必升它，改字段含义要升
SCHEMA_FORMAT_VERSION = "1.0"


def build_schema(
    *,
    entry: list[dict[str, Any]],
    steps: list[dict[str, Any]],
    target: dict[str, Any],
    task: str,
) -> dict[str, Any]:
    """拼出模型 schema。

    Args: entry（入口列的元信息）, steps（可服务表示里的步骤）, target, task。
    """
    filled = _fill_values(steps)
    return {
        "format_version": SCHEMA_FORMAT_VERSION,
        "requires_timestamp": _needs_timestamp(steps),
        "inputs": [_input_of(item, filled) for item in entry],
        "derived": _derived_of(entry, steps),
        "output": {
            "key": as_text(target.get("key")),
            "label": as_text(target.get("label")) or as_text(target.get("key")),
            "unit": as_text(target.get("unit")),
            "dtype": as_text(target.get("dtype")),
            "task": task,
        },
    }


def _needs_timestamp(steps: list[dict[str, Any]]) -> bool:
    """这条推理链要不要调用方给出这一行的时刻。

    ⚠ 时间特征在单行预测里拿不到时间索引，时刻只能由调用方给；不标出来的话
    第三方按签名把参数都填对了，调用仍然报错，而错的原因不在签名上
    （docs/MODELING_PLATFORM_DESIGN.md D19）。
    Args: steps。
    """
    return any(
        registry.get(as_text(step.get("operator"))).SERVING_NEEDS_INDEX
        for step in steps
    )


def _input_of(item: dict[str, Any], filled: dict[str, float]) -> dict[str, Any]:
    """一个入口列对外长什么样。

    Args: item, filled。
    """
    key = as_text(item.get("key"))
    return {
        "key": key,
        "label": as_text(item.get("label")) or key,
        "unit": as_text(item.get("unit")),
        "dtype": as_text(item.get("dtype")),
        "is_required": key not in filled,
        "default_on_missing": filled.get(key),
        "training_stats": as_dict(item.get("stats")),
    }


def _fill_values(steps: list[dict[str, Any]]) -> dict[str, float]:
    """哪些入口列可以不给，不给时会被填成什么。

    判据（D7）：推理链上有一步会补空值、且它学到了这一列的填充值，而**排在它
    前面的每一步也都是补空值的**。
    ⚠ 最后那个条件不能省：填充排在标准化后面时，那一列在被填之前就已经被读过
    了，不给它照样算错——而那时候界面上写着「可缺省」。
    Args: steps。
    """
    values: dict[str, float] = {}
    for step in steps:
        operator = registry.get(as_text(step.get("operator")))
        if not operator.FILLS_MISSING:
            break
        for key, value in as_dict(step.get("fitted")).items():
            if isinstance(value, (int | float)):
                values.setdefault(key, float(value))
    return values


def _derived_of(
    entry: list[dict[str, Any]], steps: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """管线自己造出来的列。调用方不必给，只做展示。

    Args: entry, steps。
    """
    seen = {as_text(item.get("key")) for item in entry}
    derived: list[dict[str, Any]] = []
    for step in steps:
        operator = registry.get(as_text(step.get("operator")))
        for key in as_texts(step.get("produced_columns")):
            if key in seen:
                continue
            seen.add(key)
            derived.append(
                {"key": key, "by": operator.CODE, "label": operator.NAME}
            )
    return derived
