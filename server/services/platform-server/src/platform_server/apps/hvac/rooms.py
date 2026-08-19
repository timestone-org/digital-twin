"""房间机组与达标范围的值对象：判定帧、模型特征与工件三处共用同一份定义。

⚠ 必须留在 `services/` 之外：训练子进程用 spawn 起，模型的入参在那边从零
import，任何指回 `services/` 的边都会绕成循环 import 并让子进程当场死掉
（docs/AC_MODEL_DESIGN.md §4）。
"""

from collections.abc import Mapping
from dataclasses import dataclass
from decimal import Decimal

METRIC_FAN_FREQUENCY = "fan_frequency"
METRIC_WORKSHOP_TEMP = "workshop_temp_avg"
METRIC_WORKSHOP_HUMIDITY = "workshop_humidity_avg"


@dataclass(frozen=True)
class MetricBand:
    """一个指标的达标范围。⚠ 单边为 None 表示该侧不限制，不表示 0。"""

    lower: Decimal | None
    upper: Decimal | None

    def contains(self, value: float) -> bool:
        """值是否落在闭区间内。

        Args: value。
        """
        if self.lower is not None and value < float(self.lower):
            return False
        return self.upper is None or value <= float(self.upper)


@dataclass(frozen=True)
class RoomUnit:
    """房间里的一台空调：序号，加上它自己那几条达标范围。

    ⚠ 达标要求**每一台**各自落在**它自己**配置的范围内；没配范围的指标视为
    该指标不限制。
    """

    serial: str
    bands: Mapping[str, MetricBand]
