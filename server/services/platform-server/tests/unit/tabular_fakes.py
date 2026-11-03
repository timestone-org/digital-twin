"""通用表格算子的固定输入与真实执行入口。"""

from datetime import UTC, datetime

from platform_server.apps.modeling.operators import (
    Frame,
    FrameColumn,
    Provenance,
    registry,
)


def table() -> Frame:
    return Frame(
        columns=(
            FrameColumn(key="id", name="编号", dtype="string"),
            FrameColumn(key="x", name="用量", dtype="number", unit="kWh"),
            FrameColumn(key="y", name="分母", dtype="number"),
            FrameColumn(key="label", name="名称", dtype="string"),
        ),
        rows=(
            ("a", 1.0, 2.0, " A "),
            ("a", 1.0, None, " A "),
            ("b", None, 0.0, "B"),
            (None, 3.0, 4.0, None),
        ),
        index=(1000, 2000, 3000, 4000),
        provenance=Provenance(
            table_codes=("meter",),
            since=datetime(2026, 1, 1, tzinfo=UTC),
            until=datetime(2026, 1, 2, tzinfo=UTC),
            is_truncated=True,
        ),
    )


def run(
    code: str, config: dict[str, object], source: Frame | None = None
) -> Frame:
    operator, _ = registry.build(code, config)
    output = operator.run({"frame": source if source is not None else table()})[
        "frame"
    ]
    assert isinstance(output, Frame)
    return output


def run_pair(
    code: str, left: Frame, right: Frame, config: dict[str, object]
) -> Frame:
    operator, _ = registry.build(code, config)
    output = operator.run({"left": left, "right": right})["frame"]
    assert isinstance(output, Frame)
    return output
