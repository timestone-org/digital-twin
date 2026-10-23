"""训练前的正常工况时长筛选与达标标签一致性甄别。

⚠ 口径前提是 `compliance_frames = 1`（`ExtractionRules` 的现网唯一取值）：起始
帧一达标事件就当场收尾，所以「起始时刻已达标」与「时长 0」必须同真同假。一条
事件上两者对不上，说明它的标签是按**另一套达标范围或另一份机组清单**算出来的
——留着它就是让模型去学一份现在已经不成立的物理。
"""

from collections.abc import Sequence
from dataclasses import dataclass

from platform_server.apps.hvac.modeling.features import EpisodeSample
from platform_server.apps.hvac.rooms import RoomUnit

MAX_NORMAL_DURATION_MINUTES = 60


@dataclass(frozen=True)
class Curated:
    """保留样本、标签不一致与超出正常时长的计数。"""

    kept: tuple[EpisodeSample, ...]
    # 开机即达标却记着非零时长——已剔除
    contradictory_count: int
    # 开机不达标却记着时长 0——只数不剔，理由见 `curate`
    unexplained_zero_count: int
    overlong_episode_count: int


def is_instantly_compliant(
    sample: EpisodeSample,
    units: Sequence[RoomUnit],
    timezone: str = "Asia/Shanghai",
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
    return all(
        unit.at(sample.conditions.started_at, timezone).is_in_band(
            readings.get(unit.serial, {})
        )
        for unit in units
    )


def curate(
    samples: Sequence[EpisodeSample],
    *,
    units: Sequence[RoomUnit],
    timezone: str = "Asia/Shanghai",
) -> Curated:
    """筛选正常工况时长，再甄别达标标签。

    ⚠ 反方向（开机不达标却记着时长 0）同样是标签过期的证据，但**只数不剔**：
    达标范围一被收窄它就覆盖整批零样本，剔掉等于把数据集删掉大半——那是
    「批次该重抽」的信号，不该由训练悄悄替人做决定。两个方向都要数：放宽范围
    只造得出前者、收窄只造得出后者，只盯一个方向就有一半的过期看不见。
    Args: samples, units。
    """
    kept: list[EpisodeSample] = []
    contradictory = 0
    unexplained = 0
    overlong_episode_count = 0
    for sample in samples:
        if sample.duration_minutes > MAX_NORMAL_DURATION_MINUTES:
            overlong_episode_count += 1
            continue
        is_compliant = is_instantly_compliant(sample, units, timezone)
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
        overlong_episode_count=overlong_episode_count,
    )
