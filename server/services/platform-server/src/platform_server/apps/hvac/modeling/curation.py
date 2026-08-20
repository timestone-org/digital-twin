"""训练前的样本甄别：把标签与当前达标范围自相矛盾的事件挡在拟合之外。

⚠ 口径前提是 `compliance_frames = 1`（`ExtractionRules` 的现网唯一取值）：起始
帧一达标事件就当场收尾，所以「起始时刻已达标」与「时长 0」必须同真同假。一条
事件上两者对不上，说明它的标签是按**另一套达标范围或另一份机组清单**算出来的
——留着它就是让模型去学一份现在已经不成立的物理。
"""

from collections.abc import Sequence
from dataclasses import dataclass

from platform_server.apps.hvac.modeling.features import EpisodeSample
from platform_server.apps.hvac.rooms import RoomUnit


@dataclass(frozen=True)
class Curated:
    """甄别结果：留下来的样本，加两个方向各自对不上的条数。"""

    kept: tuple[EpisodeSample, ...]
    # 开机即达标却记着非零时长——已剔除
    contradictory_count: int
    # 开机不达标却记着时长 0——只数不剔，理由见 `curate`
    unexplained_zero_count: int


def is_instantly_compliant(
    sample: EpisodeSample, units: Sequence[RoomUnit]
) -> bool:
    """开机那一刻整个房间是不是已经达标（每台各自落在它自己的范围内）。

    ⚠ 机组清单为空时一律给假：`all()` 在空序列上恒真，照搬就是把每条事件
    都判成开机即达标，然后把非零时长的样本全剔光。
    ⚠ 起始帧上少一台读数就不算达标，与抽取引擎的 `is_valid` 同向：机组绑定
    在抽取之后变过时，这里只会少判达标，不会多判。
    Args: sample, units。
    """
    if not units:
        return False
    readings = sample.conditions.readings
    return all(unit.is_in_band(readings.get(unit.serial, {})) for unit in units)


def curate(
    samples: Sequence[EpisodeSample], *, units: Sequence[RoomUnit]
) -> Curated:
    """剔除「开机即达标却记着非零时长」的事件，并数出反方向有多少条。

    ⚠ 反方向（开机不达标却记着时长 0）同样是标签过期的证据，但**只数不剔**：
    达标范围一被收窄它就覆盖整批零样本，剔掉等于把数据集删掉大半——那是
    「批次该重抽」的信号，不该由训练悄悄替人做决定。两个方向都要数：放宽范围
    只造得出前者、收窄只造得出后者，只盯一个方向就有一半的过期看不见。
    Args: samples, units。
    """
    kept: list[EpisodeSample] = []
    contradictory = 0
    unexplained = 0
    for sample in samples:
        is_compliant = is_instantly_compliant(sample, units)
        if is_compliant and sample.duration_minutes != 0:
            contradictory += 1
            continue
        if not is_compliant and sample.duration_minutes == 0:
            unexplained += 1
        kept.append(sample)
    return Curated(
        kept=tuple(kept),
        contradictory_count=contradictory,
        unexplained_zero_count=unexplained,
    )
