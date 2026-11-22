"""从推理链头部的冻结填充值推导入口缺省规则。"""

import math
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass

from pydantic import ValidationError

from platform_server.apps.modeling.operators import FillMissing, registry
from platform_server.apps.modeling.operators.preprocess import (
    FillMissingConfig,
    FillStrategy,
)
from platform_server.apps.modeling.services.jsonshape import as_dict, as_text


@dataclass(frozen=True)
class FrozenInputDefault:
    """入口实际采用的缺省值及可核实的填充方式。"""

    value: float
    strategy: FillStrategy | None


def leading_input_defaults(
    steps: Sequence[Mapping[str, object]],
) -> dict[str, float]:
    """只取首次非填充步骤之前的有效拟合值；Args: steps。"""
    defaults: dict[str, float] = {}
    for key, value, _ in _leading_defaults(steps):
        defaults.setdefault(key, value)
    return defaults


def leading_frozen_defaults(
    steps: Sequence[Mapping[str, object]],
) -> dict[str, FrozenInputDefault]:
    """保留首个有效缺省值及其冻结配置；Args: steps。"""
    defaults: dict[str, FrozenInputDefault] = {}
    for key, value, step in _leading_defaults(steps):
        if key not in defaults:
            defaults[key] = FrozenInputDefault(value, _strategy_of(step, value))
    return defaults


def _leading_defaults(
    steps: Sequence[Mapping[str, object]],
) -> Iterator[tuple[str, float, Mapping[str, object]]]:
    """按推理顺序产出有效的入口填充值；Args: steps。"""
    for step in steps:
        if not registry.get(as_text(step.get("operator"))).FILLS_MISSING:
            break
        for key, value in as_dict(step.get("fitted")).items():
            if (
                isinstance(value, (int, float))
                and not isinstance(value, bool)
                and math.isfinite(value)
            ):
                yield key, float(value), step


def _strategy_of(
    step: Mapping[str, object], value: float
) -> FillStrategy | None:
    """用冻结的参数确认填充方式；Args: step, value。"""
    config = step.get("config")
    if step.get("operator") != FillMissing.CODE or not isinstance(config, dict):
        return None
    try:
        parsed = FillMissingConfig.model_validate(config)
    except ValidationError:
        return None
    if parsed.strategy == "constant" and parsed.value != value:
        return None
    return parsed.strategy
