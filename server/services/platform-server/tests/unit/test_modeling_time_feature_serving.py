"""时间特征在推理时沿用训练时的业务时区，而不是按 UTC 算。

⚠ 按 UTC 算出来的小时也在 0-23 之间，预测照样出数，看不出错。
"""

from datetime import UTC, datetime

from platform_server.apps.modeling.operators import Frame, FrameColumn
from platform_server.apps.modeling.services.serving import _apply, _Step
from unit.test_modeling_tabular_serving import published

# UTC 01:00 在东八区是 09:00
MONDAY_UTC_MS = int(datetime(2026, 1, 5, 1, 0, tzinfo=UTC).timestamp() * 1000)


def _one_row() -> Frame:
    """一行温度，带时刻。"""
    return Frame(
        columns=(FrameColumn(key="温度", name="温度", dtype="number"),),
        rows=((25.0,),),
        index=(MONDAY_UTC_MS,),
    )


def _hour_after(fitted: dict[str, object]) -> object:
    """按一份落库的时间特征步骤推理一行，取造出的小时。

    Args: fitted。
    """
    step = _Step(
        operator="time_feature",
        config={"parts": ["hour"]},
        fitted=dict(fitted),
        expected=(),
    )
    return _apply(step, _one_row(), None).values_of("ts_hour")[0]


async def test_publish_freezes_the_business_offset_into_the_step() -> None:
    verdict = await published("time_feature", {"parts": ["hour"]})
    assert verdict.is_servable, verdict.reason
    step = next(
        item
        for item in verdict.serving["steps"]
        if item["operator"] == "time_feature"
    )
    assert step["fitted"] == {"tz_offset_minutes": 480}


def test_serving_uses_the_frozen_offset() -> None:
    assert _hour_after({"tz_offset_minutes": 480}) == 9.0


def test_versions_without_a_frozen_offset_keep_their_old_output() -> None:
    assert _hour_after({}) == 1.0
