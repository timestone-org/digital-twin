"""开机事件判定规则的用例 —— docs/AC_STARTUP_DESIGN.md §3 逐条钉死。

这一层守的是标签的对错：取样口径、组合窗、组合不变、达标口径、数据缺口与
上限，每一条判错都不会报错，只会让训练集里多出或少掉一批样本。
"""

from collections.abc import Iterable, Sequence
from datetime import UTC, datetime, timedelta

import pytest

from platform_server.apps.hvac.services.ac_startup_rules import (
    Episode,
    ExtractionRules,
    Frame,
    extract_episodes,
)
from platform_server.apps.hvac.startups import (
    OUTCOME_DATA_GAP,
    OUTCOME_SET_CHANGED,
    OUTCOME_TIMEOUT,
    OUTCOME_USABLE,
)

BASE = datetime(2026, 3, 1, 0, 0, tzinfo=UTC)
DEFAULTS = ExtractionRules()
# 不要求冷启动的取样口径，用来证明它只是一个参数
WARM = ExtractionRules(is_cold_start_required=False)
# 冷启动门槛用满 30 分钟，之后的分钟号都从 30 起
COLD = 30


def at(minute: int) -> datetime:
    """基准时刻起的第 n 分钟。

    Args: minute。
    """
    return BASE + timedelta(minutes=minute)


def frame(
    minute: int,
    running: Iterable[str] = (),
    *,
    is_valid: bool = True,
    is_compliant: bool = False,
) -> Frame:
    """造一帧。读数只带一个量，用例断言的是它有没有被原样带到事件上。

    Args: minute, running, is_valid, is_compliant。
    """
    serials = frozenset(running)
    return Frame(
        ts=at(minute),
        running=serials,
        is_valid=is_valid,
        is_compliant=is_compliant,
        readings={serial: {"workshop_temp_avg": 26.5} for serial in serials},
    )


def cold_frames(count: int = COLD, *, first: int = 0) -> list[Frame]:
    """连续 count 分钟的「读数可信且全停」。

    Args: count, first。
    """
    return [frame(first + offset) for offset in range(count)]


def run_frames(
    minutes: Sequence[int], running: Iterable[str], *, complied_at: int | None
) -> list[Frame]:
    """一段运行中的帧；只有 complied_at 那一分钟标成达标。

    Args: minutes, running, complied_at。
    """
    return [
        frame(minute, running, is_compliant=minute == complied_at)
        for minute in minutes
    ]


def only(episodes: Sequence[Episode]) -> Episode:
    """断言只抽出一条事件并把它取出来。

    Args: episodes。
    """
    assert len(episodes) == 1, episodes
    return episodes[0]


@pytest.mark.parametrize(
    ("off_minutes", "expected"),
    [(29, 0), (30, 1), (45, 1)],
    ids=["one-short", "exactly-thirty", "well-past"],
)
def test_cold_start_requires_thirty_all_off_minutes(
    off_minutes: int, expected: int
) -> None:
    """全停不满 30 分钟的开机不是冷启动，一条都不产出。"""
    frames = [
        *cold_frames(off_minutes),
        *run_frames(
            range(off_minutes, off_minutes + 20),
            ["K11"],
            complied_at=off_minutes + 10,
        ),
    ]
    assert len(extract_episodes(frames, rules=DEFAULTS)) == expected


def test_an_invalid_minute_breaks_the_all_off_streak() -> None:
    """无效分钟打断全停计数——整行清零看着像全停，认它就会造出假冷启动。"""
    frames = [
        *cold_frames(20),
        frame(20, is_valid=False),
        *cold_frames(20, first=21),
        *run_frames(range(41, 61), ["K11"], complied_at=50),
    ]
    assert extract_episodes(frames, rules=DEFAULTS) == []


def test_the_streak_restarts_and_still_yields_an_episode_after_a_break() -> (
    None
):
    """打断之后重新数满 30 分钟，照样是一次冷启动。"""
    frames = [
        *cold_frames(20),
        frame(20, is_valid=False),
        *cold_frames(30, first=21),
        *run_frames(range(51, 71), ["K11"], complied_at=60),
    ]
    episode = only(extract_episodes(frames, rules=DEFAULTS))
    assert episode.started_at == at(51)
    assert episode.complied_at == at(60)
    assert episode.duration_minutes == 9


def test_a_warm_start_opens_once_the_cold_requirement_is_off() -> None:
    """冷启动是取样口径不是引擎前提：关掉它，同一段数据就抽得出事件。"""
    frames = [
        *cold_frames(5),
        *run_frames(range(5, 40), ["K11"], complied_at=20),
    ]
    episode = only(extract_episodes(frames, rules=WARM))
    assert episode.started_at == at(5)
    assert episode.duration_minutes == 15
    assert extract_episodes(frames, rules=DEFAULTS) == []


def test_a_warm_start_takes_whatever_is_running_that_minute() -> None:
    """半途加开一台时，组合是那一分钟在跑的全部机组。"""
    frames = [
        *[frame(minute, ["K11"]) for minute in range(30)],
        *run_frames(range(30, 70), ["K11", "K12"], complied_at=50),
    ]
    episode = only(extract_episodes(frames, rules=WARM))
    assert episode.started_at == at(30)
    assert episode.running_set == ("K11", "K12")


def test_a_room_that_never_stops_opens_no_warm_episode() -> None:
    """⚠ 没有亲眼看到起机就不开事件，否则一条连续运行的曲线会每分钟开一条。"""
    frames = run_frames(range(60), ["K11"], complied_at=20)
    assert extract_episodes(frames, rules=WARM) == []


def test_staggered_starts_within_the_window_form_one_combination() -> None:
    """t、t+4、t+9 三台顺序启动是一次开机，不是三次也不是中途变更。"""
    frames = [
        *cold_frames(),
        frame(30, ["K11"]),
        *[frame(minute, ["K11"]) for minute in range(31, 34)],
        *[frame(minute, ["K11", "K12"]) for minute in range(34, 39)],
        *run_frames(range(39, 61), ["K11", "K12", "K13"], complied_at=60),
    ]
    episode = only(extract_episodes(frames, rules=DEFAULTS))
    assert episode.started_at == at(30)
    assert episode.running_set == ("K11", "K12", "K13")
    assert episode.complied_at == at(60)
    assert episode.duration_minutes == 30
    assert episode.outcome == OUTCOME_USABLE


def test_a_start_at_the_window_edge_still_joins_the_combination() -> None:
    """距第一台正好 10 分钟仍在窗内——组合窗是闭区间。"""
    frames = [
        *cold_frames(),
        *[frame(minute, ["K11"]) for minute in range(30, 40)],
        *run_frames(range(40, 61), ["K11", "K12"], complied_at=60),
    ]
    episode = only(extract_episodes(frames, rules=DEFAULTS))
    assert episode.running_set == ("K11", "K12")
    assert episode.outcome == OUTCOME_USABLE


def test_a_start_past_the_window_ends_the_episode() -> None:
    """距第一台 11 分钟已经出窗，再开一台即为组合变更。"""
    frames = [
        *cold_frames(),
        *[frame(minute, ["K11"]) for minute in range(30, 41)],
        *run_frames(range(41, 61), ["K11", "K12"], complied_at=60),
    ]
    episode = only(extract_episodes(frames, rules=DEFAULTS))
    assert episode.started_at == at(30)
    assert episode.running_set == ("K11",)
    assert episode.outcome == OUTCOME_SET_CHANGED
    assert episode.complied_at is None
    assert episode.duration_minutes is None


def test_the_combination_window_runs_from_the_first_start() -> None:
    """窗从第一台起算、定长：把窗收窄，第 4 分钟起的那台就出窗了。"""
    rules = ExtractionRules(combination_window_minutes=3)
    frames = [
        *cold_frames(),
        *[frame(minute, ["K11"]) for minute in range(30, 34)],
        *run_frames(range(34, 61), ["K11", "K12"], complied_at=60),
    ]
    episode = only(extract_episodes(frames, rules=rules))
    assert episode.running_set == ("K11",)
    assert episode.outcome == OUTCOME_SET_CHANGED


@pytest.mark.parametrize(
    "stop_minute", [33, 50], ids=["inside-window", "after-window"]
)
def test_a_unit_stopping_ends_the_episode(stop_minute: int) -> None:
    """停机不在组合窗的照顾范围内：任何一台停都是组合变更。"""
    frames = [
        *cold_frames(),
        *[frame(minute, ["K11", "K12"]) for minute in range(30, stop_minute)],
        *run_frames(range(stop_minute, 80), ["K11"], complied_at=70),
    ]
    episode = only(extract_episodes(frames, rules=DEFAULTS))
    assert episode.started_at == at(30)
    assert episode.running_set == ("K11", "K12")
    assert episode.outcome == OUTCOME_SET_CHANGED


def test_compliance_wins_over_a_set_change_on_the_same_minute() -> None:
    """达标与组合变更同分钟时达标优先——事件那一刻已经结束了。"""
    frames = [
        *cold_frames(),
        *[frame(minute, ["K11"]) for minute in range(30, 45)],
        frame(45, ["K11", "K12"], is_compliant=True),
        *run_frames(range(46, 60), ["K11", "K12"], complied_at=None),
    ]
    episode = only(extract_episodes(frames, rules=DEFAULTS))
    assert episode.outcome == OUTCOME_USABLE
    assert episode.complied_at == at(45)
    assert episode.duration_minutes == 15
    # K12 是出窗后才起的，不算进这次开机的组合
    assert episode.running_set == ("K11",)


@pytest.mark.parametrize("gap", [1, 3], ids=["one-minute", "at-the-limit"])
def test_a_short_gap_is_skipped_not_interpolated(gap: int) -> None:
    """孤立缺口跳过：插出来的值会让「何时进入范围」变成我们自己编的答案。"""
    missing = set(range(35, 35 + gap))
    frames = [
        *cold_frames(),
        *[
            frame(minute, ["K11"], is_compliant=minute == 50)
            for minute in range(30, 61)
            if minute not in missing
        ],
    ]
    episode = only(extract_episodes(frames, rules=DEFAULTS))
    assert episode.outcome == OUTCOME_USABLE
    assert episode.complied_at == at(50)
    assert episode.duration_minutes == 20


def test_four_missing_minutes_discard_the_episode() -> None:
    """连续超过 3 分钟的缺口整条丢弃，并标注原因。"""
    missing = {35, 36, 37, 38}
    frames = [
        *cold_frames(),
        *[
            frame(minute, ["K11"], is_compliant=minute == 50)
            for minute in range(30, 61)
            if minute not in missing
        ],
    ]
    episode = only(extract_episodes(frames, rules=DEFAULTS))
    assert episode.outcome == OUTCOME_DATA_GAP
    assert episode.started_at == at(30)
    assert episode.complied_at is None
    assert episode.duration_minutes is None


def test_invalid_frames_count_toward_the_gap_like_missing_ones() -> None:
    """清零与尖峰造出的无效帧，与整行缺失是同一件事。"""
    frames = [
        *cold_frames(),
        *[frame(minute, ["K11"]) for minute in range(30, 35)],
        *[frame(minute, ["K11"], is_valid=False) for minute in range(35, 39)],
        *run_frames(range(39, 61), ["K11"], complied_at=50),
    ]
    episode = only(extract_episodes(frames, rules=DEFAULTS))
    assert episode.outcome == OUTCOME_DATA_GAP


def test_not_complying_within_the_cap_is_a_timeout() -> None:
    """100 分钟内未达标即丢弃并标注。"""
    frames = [
        *cold_frames(),
        *run_frames(range(30, 141), ["K11"], complied_at=None),
    ]
    episode = only(extract_episodes(frames, rules=DEFAULTS))
    assert episode.outcome == OUTCOME_TIMEOUT
    assert episode.started_at == at(30)
    assert episode.complied_at is None
    assert episode.duration_minutes is None


def test_complying_exactly_at_the_cap_is_still_usable() -> None:
    """「100 分钟内」是闭区间：第 100 分钟达标算达标。"""
    frames = [
        *cold_frames(),
        *run_frames(range(30, 141), ["K11"], complied_at=130),
    ]
    episode = only(extract_episodes(frames, rules=DEFAULTS))
    assert episode.outcome == OUTCOME_USABLE
    assert episode.duration_minutes == 100


def test_compliance_needs_consecutive_frames_when_the_rule_asks_for_them() -> (
    None
):
    """达标窗做成 N 帧时要求连续 N 分钟满足，达标时刻取那一段的第一帧。"""
    rules = ExtractionRules(compliance_frames=3)
    compliant = {40, 41, 45, 46, 47}
    frames = [
        *cold_frames(),
        *[
            frame(minute, ["K11"], is_compliant=minute in compliant)
            for minute in range(30, 61)
        ],
    ]
    episode = only(extract_episodes(frames, rules=rules))
    assert episode.outcome == OUTCOME_USABLE
    assert episode.complied_at == at(45)
    assert episode.duration_minutes == 15


def test_an_invalid_minute_breaks_the_compliance_run() -> None:
    """无效分钟不是「满足」，它把连续计数打断。"""
    rules = ExtractionRules(compliance_frames=3)
    frames = [
        *cold_frames(),
        *[frame(minute, ["K11"]) for minute in range(30, 40)],
        frame(40, ["K11"], is_compliant=True),
        frame(41, ["K11"], is_valid=False),
        *[
            frame(minute, ["K11"], is_compliant=True)
            for minute in range(42, 46)
        ],
        *run_frames(range(46, 61), ["K11"], complied_at=None),
    ]
    episode = only(extract_episodes(frames, rules=rules))
    assert episode.complied_at == at(42)
    assert episode.duration_minutes == 12


def test_the_zeroing_artifact_yields_no_phantom_stop_and_start() -> None:
    """整行清零的那一分钟被掩掉，不产生一对假的停机与开机。"""
    frames = [
        *cold_frames(),
        *[frame(minute, ["K11"]) for minute in range(30, 40)],
        # 采集缺陷：这一分钟全场 fan_frequency 与车间温度一起归零
        frame(40, is_valid=False),
        *run_frames(range(41, 61), ["K11"], complied_at=55),
    ]
    episode = only(extract_episodes(frames, rules=DEFAULTS))
    assert episode.started_at == at(30)
    assert episode.running_set == ("K11",)
    assert episode.outcome == OUTCOME_USABLE
    assert episode.complied_at == at(55)


def test_the_running_set_is_sorted_ascending() -> None:
    """组合按 serial 升序，等值比较才稳定。"""
    frames = [
        *cold_frames(),
        *[frame(minute, ["K13"]) for minute in range(30, 32)],
        *[frame(minute, ["K13", "K11"]) for minute in range(32, 34)],
        *run_frames(range(34, 61), ["K13", "K11", "K12"], complied_at=50),
    ]
    episode = only(extract_episodes(frames, rules=DEFAULTS))
    assert episode.running_set == ("K11", "K12", "K13")


def test_the_starting_frame_readings_ride_along() -> None:
    """事件带的是起始帧上每台的原始读数。"""
    frames = [
        *cold_frames(),
        *run_frames(range(30, 61), ["K11", "K12"], complied_at=40),
    ]
    episode = only(extract_episodes(frames, rules=DEFAULTS))
    assert episode.readings == {
        "K11": {"workshop_temp_avg": 26.5},
        "K12": {"workshop_temp_avg": 26.5},
    }


def test_compliance_on_the_starting_frame_gives_a_zero_duration() -> None:
    """房间开机那一刻就在范围内，达标时长就是 0。"""
    frames = [
        *cold_frames(),
        *run_frames(range(30, 61), ["K11"], complied_at=30),
    ]
    episode = only(extract_episodes(frames, rules=DEFAULTS))
    assert episode.complied_at == at(30)
    assert episode.duration_minutes == 0


def test_a_second_episode_needs_its_own_cold_period() -> None:
    """一次开机结束后要重新数满 30 分钟全停，才有下一次冷启动。"""
    frames = [
        *cold_frames(),
        *run_frames(range(30, 41), ["K11"], complied_at=35),
        *cold_frames(30, first=41),
        *run_frames(range(71, 101), ["K12"], complied_at=80),
    ]
    episodes = extract_episodes(frames, rules=DEFAULTS)
    assert [episode.started_at for episode in episodes] == [at(30), at(71)]
    assert [episode.running_set for episode in episodes] == [
        ("K11",),
        ("K12",),
    ]


def test_an_episode_still_open_at_the_end_of_the_frames_is_dropped() -> None:
    """判不出结果就不猜——调用方必须向后多读，否则贴着边界的那次会消失。"""
    frames = [
        *cold_frames(),
        *run_frames(range(30, 41), ["K11"], complied_at=None),
    ]
    assert extract_episodes(frames, rules=DEFAULTS) == []


def test_frames_out_of_order_are_rejected() -> None:
    """帧序列必须严格升序，倒序或重复时刻会让缺口计数变成负的。"""
    frames = [frame(5), frame(3)]
    with pytest.raises(ValueError, match="严格升序"):
        extract_episodes(frames, rules=DEFAULTS)


def test_an_empty_frame_sequence_yields_no_episodes() -> None:
    """没有帧就没有事件。"""
    assert extract_episodes([], rules=DEFAULTS) == []
