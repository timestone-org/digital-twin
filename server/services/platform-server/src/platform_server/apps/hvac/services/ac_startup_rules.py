"""开机事件的判定规则 —— 一个只吃帧序列、只吐事件的纯函数。

本模块不碰数据库也不碰外部数据源：判定口径见 docs/AC_STARTUP_DESIGN.md §3，
每一条都直接决定标签的对错，脱离 IO 才单测得起来。帧怎么算出来在
`ac_startup_frames.py`。
"""

import hashlib
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass, fields
from datetime import datetime, timedelta

from platform_server.apps.hvac.startups import (
    OUTCOME_DATA_GAP,
    OUTCOME_SET_CHANGED,
    OUTCOME_TIMEOUT,
    OUTCOME_USABLE,
)

# ⚠ 改抽取逻辑的人手动 +1，不对代码求哈希：否则一次格式化就触发全量重算提醒，
# 很快没人理它（docs/AC_STARTUP_DESIGN.md §5）。
LOGIC_VERSION = 1

_ONE_MINUTE = timedelta(minutes=1)

Readings = Mapping[str, Mapping[str, float | None]]


@dataclass(frozen=True)
class ExtractionRules:
    """抽取的全部可调参数。取值一变，指纹就变，页面据此提醒重算。

    ⚠ 冷启动是**取样口径**而不是引擎的前提，故做成参数：实测冷启动样本稀少，
    且与现场当前主力组合反相关（主力组合成段连续运行，很少全停），换口径时
    该改的是这里的取值，不是状态机。
    """

    cold_off_minutes: int = 30
    combination_window_minutes: int = 10
    compliance_frames: int = 1
    compliance_cap_minutes: int = 100
    max_gap_minutes: int = 3
    require_cold_start: bool = True

    def __post_init__(self) -> None:
        # ⚠ 逐字段遍历而不是逐个点名：新加一条规则会自动进校验与指纹，点名写法
        # 漏一个的表现是「改了参数指纹却不变」，页面从此不再提醒重算
        for field in fields(self):
            value = getattr(self, field.name)
            # 开关只有两个取值，不参与正整数校验
            if isinstance(value, bool):
                continue
            if value < 1:
                raise ValueError(f"{field.name} 必须是正整数")

    def fingerprint(self) -> str:
        """参数指纹：全部参数取值 + `LOGIC_VERSION` 的 SHA-256。

        ⚠ 字段名进指纹、且按名字排序：只把取值拼起来的话，两个参数互换取值
        会算出同一个指纹，而它们描述的是两套完全不同的规则。
        """
        parts = [f"logic_version={LOGIC_VERSION}"]
        parts.extend(
            f"{field.name}={getattr(self, field.name)}"
            for field in sorted(fields(self), key=lambda item: item.name)
        )
        return hashlib.sha256("|".join(parts).encode()).hexdigest()


@dataclass(frozen=True)
class Frame:
    """一分钟里整个房间的状态。

    `running` 是这一分钟 `fan_frequency > 0` 的空调序号；`is_valid` 为假表示这
    一分钟的读数不可信（清零、NULL 或温度尖峰），既不能用来判运行也不能判达标。
    """

    ts: datetime
    running: frozenset[str]
    is_valid: bool
    is_compliant: bool
    readings: Readings


@dataclass(frozen=True)
class Episode:
    """一次开机事件。`outcome` 的取值见 `apps/hvac/startups.py`。"""

    started_at: datetime
    running_set: tuple[str, ...]
    complied_at: datetime | None
    outcome: str
    readings: Readings

    @property
    def duration_minutes(self) -> int | None:
        """达标时长；没达标就没有时长。"""
        if self.complied_at is None:
            return None
        delta = self.complied_at - self.started_at
        return int(delta.total_seconds() // _ONE_MINUTE.total_seconds())


def extract_episodes(
    frames: Sequence[Frame], *, rules: ExtractionRules
) -> list[Episode]:
    """按 §3 的规则从一段按时刻升序的帧序列里抽出开机事件。

    ⚠ 序列末尾仍未判完的事件不产出——判不出结果就不猜。调用方必须向前多读
    `cold_off_minutes` 分钟、向后多读 `compliance_cap_minutes` 分钟，否则贴着
    边界的那次开机会凭空消失，而调用方还会以为自己抽全了。
    Args: frames, rules。
    """
    machine = _Machine(rules)
    for minute in _minutes(frames):
        machine.step(minute)
    return machine.episodes


@dataclass(frozen=True)
class _Minute:
    """时间轴上的一分钟。`frame` 为 None 表示这一分钟整行缺失。"""

    ts: datetime
    frame: Frame | None


def _minutes(frames: Sequence[Frame]) -> Iterator[_Minute]:
    """把帧序列摊成逐分钟的时间轴，缺失的分钟补成空位。

    ⚠ 补的是空位不是插值：缺失分钟与无效帧在 §3 里是同一件事（都不能用来判定），
    摊平只为让「连续超过 N 分钟」这条规则只写一遍。
    Args: frames。
    """
    previous: datetime | None = None
    for frame in frames:
        if previous is not None:
            if frame.ts <= previous:
                raise ValueError("帧序列必须按时刻严格升序")
            cursor = previous + _ONE_MINUTE
            while cursor < frame.ts:
                yield _Minute(ts=cursor, frame=None)
                cursor += _ONE_MINUTE
        yield _Minute(ts=frame.ts, frame=frame)
        previous = frame.ts


@dataclass
class _Open:
    """一次正在判定中的开机事件。"""

    started_at: datetime
    running_set: frozenset[str]
    readings: Readings
    compliant_streak: int = 0
    compliant_since: datetime | None = None
    invalid_streak: int = 0


def _is_all_off(minute: _Minute) -> bool:
    """这一分钟是不是「读数可信且全部停机」。

    Args: minute。
    """
    frame = minute.frame
    return frame is not None and frame.is_valid and not frame.running


def _closed(
    episode: _Open, outcome: str, *, complied_at: datetime | None = None
) -> Episode:
    """把判定中的事件定格成一条结果。

    Args: episode, outcome, complied_at。
    """
    return Episode(
        started_at=episode.started_at,
        running_set=tuple(sorted(episode.running_set)),
        complied_at=complied_at,
        outcome=outcome,
        readings=episode.readings,
    )


class _Machine:
    """§3 的判定状态机：空闲时数全停分钟，开机后跟组合、达标与数据质量。"""

    def __init__(self, rules: ExtractionRules) -> None:
        self._rules = rules
        self.episodes: list[Episode] = []
        # ⚠ 从 0 起算：序列开头之前的状态我们看不见，只认亲眼数到的全停分钟
        self._off_streak = 0
        self._open: _Open | None = None

    def step(self, minute: _Minute) -> None:
        """推进一分钟。

        Args: minute。
        """
        if self._open is None:
            self._start_if_ready(minute)
        if self._open is None:
            return
        finished = self._advance(minute, self._open)
        if finished is None:
            return
        self.episodes.append(finished)
        self._open = None
        self._off_streak = 1 if _is_all_off(minute) else 0

    def _start_if_ready(self, minute: _Minute) -> None:
        """数全停分钟；够开一次事件时，这一台开机即为起始时刻。

        Args: minute。
        """
        frame = minute.frame
        if frame is None or not frame.is_valid:
            # ⚠ 无效分钟打断全停计数（§3 约定 2）：整行清零看着像全停，认它就
            # 会把一次半途加开算成冷启动
            self._off_streak = 0
            return
        if not frame.running:
            self._off_streak += 1
            return
        if self._is_startable(frame):
            self._open = _Open(
                started_at=frame.ts,
                running_set=frame.running,
                readings=frame.readings,
            )
        self._off_streak = 0

    def _is_startable(self, frame: Frame) -> bool:
        """这一分钟够不够开出一次事件；调用方已保证房间里有机组在跑。

        ⚠ 不要求冷启动时改判当前状态：在跑但没达标的任一分钟都是一个样本，
        达标那一分钟不是——不挡住达标的分钟，房间一进范围就会立刻再开一条
        零时长的事件，然后每分钟一条。
        Args: frame。
        """
        if self._rules.require_cold_start:
            return self._off_streak >= self._rules.cold_off_minutes
        return not frame.is_compliant

    def _advance(self, minute: _Minute, episode: _Open) -> Episode | None:
        """判定中的事件走一分钟，判完就给出结果，否则给 None。

        Args: minute, episode。
        """
        frame = minute.frame
        if frame is None or not frame.is_valid:
            return self._on_invalid(episode)
        episode.invalid_streak = 0
        # ⚠ 达标先判：达标与运行集变更落在同一分钟时达标优先（§3 约定 1）
        complied = self._on_compliance(frame, episode)
        if complied is not None:
            return complied
        changed = self._on_membership(frame, episode)
        if changed is not None:
            return changed
        span = timedelta(minutes=self._rules.compliance_cap_minutes)
        if frame.ts - episode.started_at >= span:
            return _closed(episode, OUTCOME_TIMEOUT)
        return None

    def _on_invalid(self, episode: _Open) -> Episode | None:
        """无效或缺失的一分钟：跳过，不插值，连续超限即整条丢弃。

        Args: episode。
        """
        episode.compliant_streak = 0
        episode.compliant_since = None
        episode.invalid_streak += 1
        if episode.invalid_streak > self._rules.max_gap_minutes:
            return _closed(episode, OUTCOME_DATA_GAP)
        return None

    def _on_compliance(self, frame: Frame, episode: _Open) -> Episode | None:
        """达标判定。达标时刻取连续满足那一段的第一帧。

        Args: frame, episode。
        """
        if not frame.is_compliant:
            episode.compliant_streak = 0
            episode.compliant_since = None
            return None
        episode.compliant_streak += 1
        if episode.compliant_since is None:
            episode.compliant_since = frame.ts
        if episode.compliant_streak < self._rules.compliance_frames:
            return None
        return _closed(
            episode, OUTCOME_USABLE, complied_at=episode.compliant_since
        )

    def _on_membership(self, frame: Frame, episode: _Open) -> Episode | None:
        """运行组合的变化：组合窗内的新增并入组合，其余一律判为组合变更。

        Args: frame, episode。
        """
        if frame.running == episode.running_set:
            return None
        left = episode.running_set - frame.running
        if left or not self._joins(frame.ts, episode):
            return _closed(episode, OUTCOME_SET_CHANGED)
        episode.running_set = episode.running_set | frame.running
        return None

    def _joins(self, ts: datetime, episode: _Open) -> bool:
        """新开的这台还在不在组合窗内。

        ⚠ 窗**从第一台起算且定长**，不随后续每一台顺延。实测 964 次候选开机上，
        「距上一台 10 分钟 + 距第一台累计 10 分钟」两条里后者永远先到，滚动那一
        半一次都没生效过，故只留定长这一条。真要滚动，得让累计上限大于窗宽，
        那必须是一次有意的改动而不是两个参数正好抵消。
        ⚠ 人工逐台启动会有间隔，窗开得太窄会把一次正常的顺序启动误判成中途变更。
        Args: ts, episode。
        """
        return ts - episode.started_at <= timedelta(
            minutes=self._rules.combination_window_minutes
        )
