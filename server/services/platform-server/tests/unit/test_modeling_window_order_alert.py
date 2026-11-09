"""滞后与滚动特征按行序数：行序不是时序时讲解当场告警。

⚠ 同一时刻的重复行（按行来源取全部时常见）不算乱序，不该告警。
"""

import pytest

from platform_server.apps.modeling.operators import Frame, FrameColumn, registry
from platform_server.apps.modeling.operators.windowblocks import (
    OUT_OF_ORDER_ALERT,
)
from unit.modeling_fakes import alerts_of

MINUTE = 60_000


def _frame(index: tuple[int, ...]) -> Frame:
    """Args: index。"""
    return Frame(
        columns=(FrameColumn(key="温度", name="温度", dtype="number"),),
        rows=tuple((float(seat),) for seat in range(len(index))),
        index=index,
    )


def _alerts(code: str, index: tuple[int, ...], **config: object) -> list[str]:
    """Args: code, index, config。"""
    operator, _ = registry.build(code, {"columns": ["温度"], **config})
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    operator.run({"frame": _frame(index)})
    return alerts_of(operator.report()[0])


@pytest.mark.parametrize(
    ("code", "config"),
    [("lag_feature", {"lags": [1]}), ("rolling_feature", {"window": 2})],
)
def test_rows_out_of_time_order_raise_an_alert(
    code: str, config: dict[str, object]
) -> None:
    assert OUT_OF_ORDER_ALERT in _alerts(
        code, (MINUTE, 0, 2 * MINUTE), **config
    )


@pytest.mark.parametrize(
    ("code", "config"),
    [("lag_feature", {"lags": [1]}), ("rolling_feature", {"window": 2})],
)
def test_duplicate_moments_are_not_out_of_order(
    code: str, config: dict[str, object]
) -> None:
    assert OUT_OF_ORDER_ALERT not in _alerts(code, (0, 0, MINUTE), **config)
