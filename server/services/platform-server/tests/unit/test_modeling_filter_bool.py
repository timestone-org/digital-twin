"""条件过滤能筛类型归一产出的布尔列，文本列仍然拒绝。"""

import pytest

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    OperatorError,
    registry,
)


def _filtered(frame: Frame, **config: object) -> Frame:
    """Args: frame, config。"""
    operator, _ = registry.build("filter_rows", dict(config))
    operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
    produced = operator.run({"frame": frame})["frame"]
    assert isinstance(produced, Frame)
    return produced


def test_a_boolean_column_keeps_only_the_true_rows() -> None:
    frame = Frame(
        columns=(FrameColumn(key="开机", name="开机", dtype="bool"),),
        rows=((True,), (False,), (None,), (True,)),
    )
    got = _filtered(frame, column="开机", op="eq", value=1)
    assert got.values_of("开机") == [True, True]


def test_a_text_column_is_still_refused() -> None:
    frame = Frame(
        columns=(FrameColumn(key="状态", name="状态", dtype="string"),),
        rows=(("开",), ("关",)),
    )
    with pytest.raises(OperatorError):
        _filtered(frame, column="状态", op="gte", value=1)
