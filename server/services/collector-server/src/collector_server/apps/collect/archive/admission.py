"""归档准入：一条读数够不够格进历史，以及订阅模式下心跳补发的判定。

口径见 COLLECT_DESIGN.md §4.3 的 ③ 与 ③'；缓冲与落流在 buffer.py。
⚠ 本模块只认四元组 `(point_code, value, ts_ms, quality)`，不认识任何驱动。
"""

import math
from dataclasses import dataclass, replace
from uuid import UUID

from collector_server.apps.collect.drivers.base import Sample
from collector_server.clock import Clock, utc_now_ms
from collectwire import CollectPlan
from timeseries import Quality

PointKey = tuple[UUID, str]


@dataclass(frozen=True)
class ArchivePolicy:
    """一个点位的归档准入参数。取值来自计划，口径见 COLLECT_DESIGN.md §4.3。"""

    archive_enabled: bool = True
    deadband: float = 0.0
    max_interval_ms: int = 0


# ⚠ 计划里查不到的点位按「照常归档」处理：计划刚变而索引还没重建的那一瞬，
# 宁可多写几行也不要在库里留一段没人察觉的空白
DEFAULT_POLICY = ArchivePolicy()
DISABLED_POLICY = ArchivePolicy(archive_enabled=False)


def policies_of(plan: CollectPlan) -> dict[PointKey, ArchivePolicy]:
    """把一份计划压成按点位取策略的平表——热路径上只查一次字典。

    Args: plan。
    """
    return {
        (source.source_id, point.point_code): ArchivePolicy(
            archive_enabled=point.archive_enabled,
            deadband=point.deadband,
            max_interval_ms=point.archive_max_interval_ms,
        )
        for source in plan.sources
        for point in source.points
    }


def is_beyond_deadband(
    previous: object, value: object, deadband: float
) -> bool:
    """两个读数之间的差值算不算越过了死区。

    ⚠ 用 `>` 而不是 `>=`：死区 0 的语义是「变了就记」，取 `>=` 会连没变的
    读数一起记下来。
    ⚠ bool 走相等比较：开关量的「死区」没有意义，而 bool 是 int 的子类，
    不先挡下来就会掉进数值分支。

    Args: previous, value, deadband。
    """
    if isinstance(previous, bool) or isinstance(value, bool):
        return previous != value
    if isinstance(previous, int | float) and isinstance(value, int | float):
        before, after = float(previous), float(value)
        if not (math.isfinite(before) and math.isfinite(after)):
            # ⚠ NaN 参与相减恒为 NaN、`>` 恒假：NaN 基线会挡掉之后每一次变化
            return not (math.isnan(before) and math.isnan(after)) and (
                before != after
            )
        return abs(after - before) > deadband
    return previous != value


@dataclass(frozen=True)
class _Baseline:
    """一个点位上一条**已归档**的读数，外加心跳网格的锚。

    锚 = 最后一条**实测**归档读数的时刻与收到它的本地时刻：心跳的时间戳从锚
    按本地流逝的时间外推，不直接抄本地时钟（理由见 `AdmissionGate.heartbeat`）。
    """

    value: object
    ts_ms: int
    quality: Quality
    source_ts_ms: int
    anchor_ts_ms: int
    anchor_at_ms: int


class AdmissionGate:
    """按策略决定一条读数要不要进归档，并记住每个点位**上一条已归档**的读数。"""

    def __init__(self, *, clock: Clock = utc_now_ms) -> None:
        """按时钟初始化。

        Args: clock（收到读数的本地时刻从这里取，是心跳外推的锚）。
        """
        self._clock = clock
        self._archived: dict[PointKey, _Baseline] = {}
        # 每个点位最近一次**见过**的值与质量，归没归档都记：心跳补的是「此刻
        # 的值」，被死区吞掉的那点变化也算数
        self._seen: dict[PointKey, Sample] = {}

    def admit(
        self,
        key: PointKey,
        policy: ArchivePolicy,
        sample: Sample,
        *,
        is_polling: bool = False,
    ) -> Sample | None:
        """首值、心跳到期、质量变化或超死区时，返回应归档的读数。

        ⚠ 基线是上一条**已归档**的读数，不是上一条见过的读数：拿见过的当
        基线，一条缓慢爬升的曲线可以永远不触发死区而一行都不落库。

        Args: key, policy, sample, is_polling。
        """
        seen = self._seen.get(key)
        self._seen[key] = sample
        if not policy.archive_enabled:
            self._archived.pop(key, None)
            return None
        now_ms = self._clock()
        previous = self._archived.get(key)
        value, ts_ms, quality = sample
        if previous is None:
            if is_polling and sample == seen and quality != "bad":
                # ⚠ 恢复归档时，旧设备时间戳可能已经落过库。
                sample = (value, max(ts_ms, now_ms), quality)
        elif not self._is_due(previous, sample, policy, is_polling=is_polling):
            if not is_polling or not self._poll_due(
                previous, policy, quality, now_ms
            ):
                return None
            # ⚠ 时间戳停在上次变化时，用本轮成功读取的时刻归档。
            sample = (value, now_ms, quality)
        self._archived[key] = self._baseline_of(
            sample, policy, now_ms, source_ts_ms=ts_ms
        )
        return sample

    def heartbeat(
        self, key: PointKey, policy: ArchivePolicy, now_ms: int
    ) -> Sample | None:
        """为已开启归档的订阅点位写首值或到期的心跳。

        ⚠ 周期心跳落在「锚 + 整数个心跳」的网格上：① 设备
        时钟与本地时钟有偏差时，抄本地时钟会让心跳行排到下一条实测读数之后，
        台账按桶取末值就取到这条陈值；② 整齐的网格保证任何不窄于心跳的桶里
        都恰好落一行，而「到期才发、发时取当下」会因扫描抖动一格比一格晚，
        隔一阵就整个跳过一个桶。
        ⚠ 停摆超过两个心跳只补最近那一格，不倒着补：那段时间没人在看现场，
        补出来的行与实测的分不开。

        Args: key, policy, now_ms。
        """
        baseline = self._archived.get(key)
        seen = self._seen.get(key)
        if seen is None or not policy.archive_enabled:
            return None
        value, _, quality = seen
        if baseline is None:
            if quality == "bad":
                return None
            sample = (value, now_ms, quality)
            self._archived[key] = self._baseline_of(sample, policy, now_ms)
            return sample
        if policy.max_interval_ms <= 0:
            return None
        slots = (now_ms - baseline.anchor_at_ms) // policy.max_interval_ms
        ts_ms = baseline.anchor_ts_ms + slots * policy.max_interval_ms
        if ts_ms <= baseline.ts_ms:
            return None
        self._archived[key] = replace(
            baseline, value=value, ts_ms=ts_ms, quality=quality
        )
        return (value, ts_ms, quality)

    def seen_keys(self) -> list[PointKey]:
        """此刻记着「见过」的点位。快照式返回，扫描途中增删都安全。"""
        return list(self._seen)

    def forget_seen(self, key: PointKey) -> None:
        """忘掉一个点位「见过」的读数。数据源掉线时用：重连之前它的值算未知。

        ⚠ 基线不动：重连后订阅推回来的初值仍按死区与心跳判，值没变就不多写
        一行，而心跳网格也从原来的锚接着走。

        Args: key。
        """
        self._seen.pop(key, None)

    def invalidate(self, key: PointKey) -> None:
        """点位的订阅失效时丢弃旧观测与归档基线。Args: key。"""
        self._seen.pop(key, None)
        self._archived.pop(key, None)

    def retain(
        self,
        keys: frozenset[PointKey],
        *,
        archive_keys: frozenset[PointKey] | None = None,
    ) -> None:
        """按计划保留已配置点位的观测和已开启归档的点位基线。

        ⚠ 也是「删掉再加回来」的正确解：基线跟着点位一起走，加回来的点位
        因此重新算首值，而不是被一条几个月前的旧基线挡住。

        Args: keys, archive_keys。
        """
        active = keys if archive_keys is None else archive_keys
        for key in [key for key in self._archived if key not in active]:
            del self._archived[key]
        for key in [key for key in self._seen if key not in keys]:
            del self._seen[key]

    def size(self) -> int:
        """记着基线的点位数。"""
        return len(self._archived)

    @staticmethod
    def _baseline_of(
        sample: Sample,
        policy: ArchivePolicy,
        now_ms: int,
        *,
        source_ts_ms: int | None = None,
    ) -> _Baseline:
        """一条刚归档的实测读数当基线，并定下心跳网格的锚。

        ⚠ 读数的时刻离本地此刻超过一个心跳就不拿它当锚，改用本地时钟：订阅
        的初值带的是**上一次变化**的时刻（可能是几天前），从它外推的心跳会
        整批落进过去、与旧行撞主键而静默丢掉。一个心跳之内的差才当作设备
        时钟与本地时钟的偏差，沿用设备时钟。

        Args: sample, policy, now_ms。
        """
        value, ts_ms, quality = sample
        is_fresh = abs(now_ms - ts_ms) <= policy.max_interval_ms
        return _Baseline(
            value=value,
            ts_ms=ts_ms,
            quality=quality,
            source_ts_ms=ts_ms if source_ts_ms is None else source_ts_ms,
            anchor_ts_ms=ts_ms if is_fresh else now_ms,
            anchor_at_ms=now_ms,
        )

    @staticmethod
    def _is_due(
        previous: _Baseline,
        sample: Sample,
        policy: ArchivePolicy,
        *,
        is_polling: bool,
    ) -> bool:
        """除首值外的三条准入。

        Args: previous, sample, policy。
        """
        value, ts_ms, quality = sample
        if quality != previous.quality:
            return True
        if (
            policy.max_interval_ms > 0
            and ts_ms
            - (previous.source_ts_ms if is_polling else previous.ts_ms)
            >= policy.max_interval_ms
        ):
            return True
        return is_beyond_deadband(previous.value, value, policy.deadband)

    @staticmethod
    def _poll_due(
        previous: _Baseline,
        policy: ArchivePolicy,
        quality: Quality,
        now_ms: int,
    ) -> bool:
        """成功的轮询到期且能产生新时间戳。

        Args: previous, policy, quality, now_ms。
        """
        return (
            quality != "bad"
            and policy.max_interval_ms > 0
            and now_ms - previous.anchor_at_ms >= policy.max_interval_ms
            and now_ms != previous.ts_ms
        )
