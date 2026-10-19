"""设备正常工况样本，三项指标存在稳定相关关系。"""

import math

from platform_server.apps.modeling.operators import Frame, FrameColumn
from platform_server.apps.modeling.operators.frame import select_rows


def normal_frame(rows: int = 500) -> Frame:
    values = []
    for seat in range(rows):
        frequency = 40 + 8 * math.sin(seat * 0.61)
        temperature = 55 + 0.4 * frequency + 1.3 * math.cos(seat * 0.37)
        current = (
            5
            + 0.45 * frequency
            + 0.15 * temperature
            + 0.1 * math.sin(seat * 1.73)
        )
        values.append((current, frequency, temperature))
    return Frame(
        columns=tuple(
            FrameColumn(key=key, name=key, dtype="number", unit=unit)
            for key, unit in zip(
                ("电流", "频率", "温度"), ("A", "Hz", "℃"), strict=True
            )
        ),
        rows=tuple(values),
        index=tuple(seat * 60_000 for seat in range(rows)),
    )


def training_pair() -> dict[str, Frame]:
    source = normal_frame()
    return {
        "train": select_rows(source, list(range(400))),
        "test": select_rows(source, list(range(400, 500))),
    }
