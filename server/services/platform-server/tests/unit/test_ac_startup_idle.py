"""全停时长 `idle_minutes` 的判定用例 —— docs/AC_MODEL_DESIGN.md §2.5。

它是蓄热特征的数据源：多算会让模型高估蓄热、少算只是损失一点信息，
所以口径是「只认亲眼数到的，截断在回看上限」。
造帧的公共件复用规则用例那份，口径只能有一份。
"""

from platform_server.apps.hvac.services.ac_startup_rules import (
    ExtractionRules,
    extract_episodes,
)
from unit.test_ac_startup_rules import (
    DEFAULTS,
    WARM,
    at,
    cold_frames,
    frame,
    only,
    run_frames,
)


def test_idle_minutes_is_the_observed_all_off_count() -> None:
    """全停时长记的是起始前亲眼数到的全停分钟数。"""
    frames = [
        *cold_frames(45),
        *run_frames(range(45, 56), ["K11"], complied_at=50),
    ]
    episode = only(extract_episodes(frames, rules=DEFAULTS))
    assert episode.idle_minutes == 45


def test_idle_minutes_is_capped_at_the_lookback() -> None:
    """⚠ 回看上限封顶：上限之外的全停看不见，也不该假装数到了。"""
    rules = ExtractionRules(idle_lookback_minutes=40)
    frames = [
        *cold_frames(60),
        *run_frames(range(60, 71), ["K11"], complied_at=65),
    ]
    episode = only(extract_episodes(frames, rules=rules))
    assert episode.idle_minutes == 40


def test_idle_minutes_restarts_after_an_invalid_minute() -> None:
    """⚠ 无效分钟清零计数（§3 约定 2）：全停时长与冷启动判定共用同一个计数，
    不允许「判冷启动时不算、记时长时又算上」的分叉。"""
    frames = [
        *cold_frames(10),
        frame(10, is_valid=False),
        *cold_frames(30, first=11),
        *run_frames(range(41, 52), ["K11"], complied_at=45),
    ]
    episode = only(extract_episodes(frames, rules=DEFAULTS))
    assert episode.idle_minutes == 30


def test_a_warm_start_records_the_short_idle_it_saw() -> None:
    """不要求冷启动时，起始前只停了几分钟就记几分钟。"""
    frames = [
        *run_frames(range(3), ["K11"], complied_at=None),
        *cold_frames(5, first=3),
        *run_frames(range(8, 30), ["K12"], complied_at=20),
    ]
    episodes = extract_episodes(frames, rules=WARM)
    assert episodes[-1].started_at == at(8)
    assert episodes[-1].idle_minutes == 5
