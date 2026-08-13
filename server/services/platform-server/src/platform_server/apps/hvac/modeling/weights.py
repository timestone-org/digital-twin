"""时间衰减的样本权重 —— 老样本降权而不是丢弃。

⚠ 运行模式在迁移，全史等权会让模型以为旧主力组合仍是常态；只用近期又会
丢掉整个冬季（AC_STARTUP_DESIGN §6.4）。季节由特征承担，这里只管新旧。
"""

from collections.abc import Sequence
from datetime import datetime

_SECONDS_PER_DAY = 86400.0


def decay_weights(
    started_ats: Sequence[datetime], *, half_life_days: float
) -> list[float]:
    """半衰期式权重：最新样本为 1，每老一个半衰期减半。

    基准取样本里最新的时刻而不是训练时刻——权重只由数据决定，同一份数据
    什么时候训都得到同一组权重。
    Args: started_ats, half_life_days。
    """
    if half_life_days <= 0:
        raise ValueError("半衰期必须是正数")
    if not started_ats:
        return []
    newest = max(started_ats)
    return [
        0.5
        ** (
            (newest - moment).total_seconds()
            / _SECONDS_PER_DAY
            / half_life_days
        )
        for moment in started_ats
    ]
