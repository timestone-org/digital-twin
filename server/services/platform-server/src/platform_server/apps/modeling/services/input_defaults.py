"""从推理链头部的冻结填充值推导入口缺省规则。"""

import math
from collections.abc import Mapping, Sequence

from platform_server.apps.modeling.operators import registry
from platform_server.apps.modeling.services.jsonshape import as_dict, as_text


def leading_input_defaults(
    steps: Sequence[Mapping[str, object]],
) -> dict[str, float]:
    """只取首次非填充步骤之前的有效拟合值；Args: steps。"""
    defaults: dict[str, float] = {}
    for step in steps:
        if not registry.get(as_text(step.get("operator"))).FILLS_MISSING:
            break
        for key, value in as_dict(step.get("fitted")).items():
            if (
                isinstance(value, (int, float))
                and not isinstance(value, bool)
                and math.isfinite(value)
            ):
                defaults.setdefault(key, float(value))
    return defaults
