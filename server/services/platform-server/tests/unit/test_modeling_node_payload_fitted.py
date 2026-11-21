"""测试分支回灌空拟合结果时，算子不会就地重新学习。"""

import pytest

from platform_server.apps.modeling.operators import Frame, FrameColumn
from platform_server.apps.modeling.services.node_task import (
    NodePayload,
    run_node_payload,
)


@pytest.mark.parametrize(
    ("operator", "config"),
    [("fill_missing", {}), ("clip_outlier", {"threshold": 0.1})],
)
def test_empty_training_parameters_are_reused(
    operator: str, config: dict[str, object]
) -> None:
    frame = Frame(
        columns=(FrameColumn(key="输入", name="输入", dtype="number"),),
        rows=((1.0,), (2.0,), (None,), (50.0,)),
    )

    result = run_node_payload(
        NodePayload(
            operator=operator,
            config=config,
            inputs={"frame": frame},
            tz_offset_minutes=0,
            split_plan=None,
            fitted={},
        )
    )

    assert result.fitted == {}
    assert result.outputs["frame"] == frame
