"""留空选列的带拟合算子不碰已打成目标的列，即便下游没有切分计划。

⚠ 切分之后的帧上目标列已经带着角色：只按切分计划认目标的话，接在切分下游的
标准化会把目标列一起缩放，预测值不再在原尺度上，结果却看着完全正常。
"""

from platform_server.apps.modeling.operators import Frame, FrameColumn, registry
from platform_server.apps.modeling.operators.frame import (
    ROLE_FEATURE,
    ROLE_TARGET,
)


def test_standardize_leaves_a_target_role_column_alone() -> None:
    frame = Frame(
        columns=(
            FrameColumn(
                key="温度", name="温度", dtype="number", role=ROLE_FEATURE
            ),
            FrameColumn(
                key="能耗", name="能耗", dtype="number", role=ROLE_TARGET
            ),
        ),
        rows=((10.0, 100.0), (30.0, 300.0)),
    )
    operator, _ = registry.build("standardize", {})
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    produced = operator.run({"frame": frame})["frame"]
    assert isinstance(produced, Frame)
    assert produced.values_of("能耗") == [100.0, 300.0]
