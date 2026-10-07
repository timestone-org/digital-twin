"""墙钟桶身份的有序网格、真实样本区间与关闭前沿。

身份解析和取数边界分开，约定见 docs/DATASET_DESIGN.md §4.5。
"""

from __future__ import annotations

import heapq
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import wraps
from zoneinfo import ZoneInfo

from lib.utils.timeutils import to_utc

BUCKET_ORIGIN = datetime(2000, 1, 3)  # noqa: DTZ001
_UTC_ORIGIN = BUCKET_ORIGIN.replace(tzinfo=UTC)
_EPSILON = timedelta(microseconds=1)
# IANA 的最大日期跳变为一整天；两侧各留两天恢复 nominal label。
_MARGIN = timedelta(days=2)
# IANA 相邻时区跳变之间超过半天，探测后精确二分到微秒边界。
_PROBE = timedelta(hours=12)


def _datetime_boundary[**P, R](function: Callable[P, R]) -> Callable[P, R]:
    """把无法表示的日期或完整 preimage 边界转成校验错误。

    Args: function。
    """

    @wraps(function)
    def checked(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return function(*args, **kwargs)
        except OverflowError as exc:
            raise ValueError("日期边界无法表示完整桶区间") from exc

    return checked


@dataclass(frozen=True)
class BucketDescriptor:
    """一个身份全部真实样本的最早起点与最终右开界。"""

    identity: datetime
    source_start: datetime
    close_at: datetime


@dataclass(frozen=True)
class _OffsetSegment:
    since: datetime
    until: datetime
    offset: timedelta


@dataclass(frozen=True)
class _IdentityRun:
    first: datetime
    last: datetime


@dataclass(frozen=True)
class BucketSelection:
    """稀疏身份集合的紧凑等差段；计数与跨步不逐桶展开。"""

    runs: tuple[_IdentityRun, ...]
    interval: timedelta

    @property
    def count(self) -> int:
        return sum(
            (run.last - run.first) // self.interval + 1 for run in self.runs
        )

    @property
    def first(self) -> datetime:
        if not self.runs:
            raise ValueError("桶集合为空")
        return min(run.first for run in self.runs)

    @property
    def last(self) -> datetime:
        if not self.runs:
            raise ValueError("桶集合为空")
        return max(run.last for run in self.runs)

    def between(self, first: datetime, last: datetime) -> BucketSelection:
        """按身份闭区间裁剪，保留稀疏段。

        Args: first, last。
        """
        first, last = to_utc(first), to_utc(last)
        clipped = (
            _clip_run(run, first, last, self.interval) for run in self.runs
        )
        return BucketSelection(
            tuple(run for run in clipped if run is not None), self.interval
        )

    def rank(self, identity: datetime) -> int:
        """不晚于这个身份的数量。

        Args: identity。
        """
        identity = to_utc(identity)
        return sum(
            max(
                0,
                (min(identity, run.last) - run.first) // self.interval + 1,
            )
            for run in self.runs
        )

    def at(self, index: int) -> datetime:
        """按升序序号取一个身份，不展开之前的桶。

        Args: index。
        """
        if not 0 <= index < self.count:
            raise IndexError("桶序号超出范围")
        left, right = self.first, self.last
        while left < right:
            middle = left + ((right - left) // _EPSILON // 2) * _EPSILON
            if self.rank(middle) > index:
                right = middle
            else:
                left = middle + _EPSILON
        return left

    def take(self, limit: int) -> BucketSelection:
        """保留最早 limit 个身份。

        Args: limit。
        """
        if limit <= 0 or not self.count:
            return BucketSelection((), self.interval)
        return self.between(self.first, self.at(min(limit, self.count) - 1))

    def tail(self, limit: int) -> BucketSelection:
        """保留最后 limit 个身份。

        Args: limit。
        """
        if limit <= 0 or not self.count:
            return BucketSelection((), self.interval)
        return self.between(self.at(max(0, self.count - limit)), self.last)

    def without(self, other: BucketSelection) -> BucketSelection:
        """减掉另一份同桶宽身份集合，保留紧凑段。

        Args: other。
        """
        if self.interval != other.interval:
            raise ValueError("桶宽不一致")
        runs = self.runs
        for excluded in other.runs:
            runs = tuple(
                part
                for run in runs
                for part in _subtract_run(run, excluded, self.interval)
            )
        return BucketSelection(runs, self.interval)

    def iterate(self) -> Iterator[datetime]:
        """按身份合并等差段，严格升序。

        Args: 无。
        """
        pending = [(run.first, index) for index, run in enumerate(self.runs)]
        heapq.heapify(pending)
        while pending:
            identity, index = heapq.heappop(pending)
            yield identity
            following = identity + self.interval
            if following <= self.runs[index].last:
                heapq.heappush(pending, (following, index))

    def sequence(self) -> tuple[datetime, ...]:
        return tuple(self.iterate())


@dataclass(frozen=True)
class BucketGrid:
    """同一桶宽与业务时区下可被 SQL 产出的身份集合。"""

    interval: timedelta
    timezone: str

    def __post_init__(self) -> None:
        if self.interval <= timedelta(0):
            raise ValueError("桶宽必须为正")

    @property
    def zone(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)

    @_datetime_boundary
    def align(self, moment: datetime) -> datetime:
        """墙钟取整后按 PostgreSQL 解析，保留既定桶身份。

        Args: moment。
        """
        local = to_utc(moment).astimezone(self.zone).replace(tzinfo=None)
        return _project(_label(self._index(local), self.interval), self.zone)

    def _index(self, local: datetime) -> int:
        return (local - BUCKET_ORIGIN) // self.interval

    @_datetime_boundary
    def selection(self, first: datetime, last: datetime) -> BucketSelection:
        """身份闭区间内的全部可达桶。

        Args: first, last。
        """
        first, last = to_utc(first), to_utc(last)
        if last < first:
            return BucketSelection((), self.interval)
        return self._source_selection(first - _MARGIN, last + _MARGIN).between(
            first, last
        )

    def _source_selection(
        self, since: datetime, until: datetime
    ) -> BucketSelection:
        since, until = to_utc(since), to_utc(until)
        segments = _segments(since - _MARGIN, until + _MARGIN, self.zone)
        indexes = _reachable_indexes(segments, since, until, self.interval)
        runs = _identity_runs(indexes, segments, self.interval)
        return BucketSelection(_merge_runs(runs, self.interval), self.interval)

    @_datetime_boundary
    def identities_for_span(
        self, since: datetime, until: datetime
    ) -> BucketSelection:
        """与真实 UTC 请求闭区间相交的桶，保留稀疏身份。

        Args: since, until。
        """
        since, until = to_utc(since), to_utc(until)
        if until < since:
            raise ValueError("结束时刻不能早于开始时刻")
        return self._source_selection(since, until + _EPSILON)

    @_datetime_boundary
    def retained(
        self, selected: BucketSelection, raw_cutoff: datetime
    ) -> BucketSelection:
        """只保留全部真实样本都在保留期内的桶。

        Args: selected, raw_cutoff。
        """
        if not selected.count:
            return selected
        raw_cutoff = to_utc(raw_cutoff)
        eligible = selected.between(raw_cutoff, selected.last)
        partial = self._source_selection(raw_cutoff - _MARGIN, raw_cutoff)
        return eligible.without(partial)

    @_datetime_boundary
    def floor(self, key: datetime) -> datetime:
        """不晚于 UTC 身份键的最后一个可达桶。

        Args: key。
        """
        key = to_utc(key)
        return self.selection(key - _MARGIN - self.interval, key).last

    @_datetime_boundary
    def ceil(self, key: datetime) -> datetime:
        """不早于 UTC 身份键的第一个可达桶。

        Args: key。
        """
        key = to_utc(key)
        return self.selection(key, key + _MARGIN + self.interval).first

    @_datetime_boundary
    def shift(self, identity: datetime, steps: int) -> datetime:
        """在严格有序的可达身份中移 steps 格，拒绝非网格身份。

        Args: identity, steps。
        """
        identity = to_utc(identity)
        edge = identity + steps * self.interval
        selected = self.selection(
            min(identity, edge) - _MARGIN,
            max(identity, edge) + _MARGIN,
        )
        if not selected.between(identity, identity).count:
            raise ValueError("时刻不是可达桶身份")
        return selected.at(selected.rank(identity) - 1 + steps)

    def sequence(self, first: datetime, last: datetime) -> tuple[datetime, ...]:
        return self.selection(first, last).sequence()

    def count(self, first: datetime, last: datetime, ceiling: int) -> int:
        return min(self.selection(first, last).count, ceiling + 1)

    @_datetime_boundary
    def last_closed(self, now: datetime) -> datetime:
        """最小尚未关闭身份之前的桶，形成有序水位前沿。

        Args: now。
        """
        # ⚠ 将来的真实样本可能回到较早身份，不能取已闭身份的最大值。
        now = to_utc(now)
        first_open = self._source_selection(
            now, now + _MARGIN + self.interval
        ).first
        return self.shift(first_open, -1)

    @_datetime_boundary
    def describe(self, identity: datetime) -> BucketDescriptor:
        """恢复原墙钟标签，合并同身份的全部真实样本区间。

        Args: identity。
        """
        identity = to_utc(identity)
        segments = _segments(identity - _MARGIN, identity + _MARGIN, self.zone)
        return self._describe(identity, segments)

    def _describe(
        self, identity: datetime, segments: tuple[_OffsetSegment, ...]
    ) -> BucketDescriptor:
        identity = to_utc(identity)
        nominal_labels = {
            identity.replace(tzinfo=None) + segment.offset
            for segment in segments
        }
        parts = [
            part
            for local in nominal_labels
            if _label(self._index(local), self.interval) == local
            and _project(local, self.zone) == identity
            for part in _preimages(local, self.interval, segments)
        ]
        if not parts:
            raise ValueError("时刻不是可达桶身份")
        return BucketDescriptor(
            identity=identity,
            source_start=min(part[0] for part in parts),
            close_at=max(part[1] for part in parts),
        )

    @_datetime_boundary
    def bounds(self, starts: Sequence[datetime]) -> tuple[datetime, datetime]:
        """一批身份的完整真实样本包络。

        Args: starts。
        """
        if not starts:
            raise ValueError("桶集合为空")
        starts = tuple(to_utc(start) for start in starts)
        segments = _segments(
            min(starts) - _MARGIN, max(starts) + _MARGIN, self.zone
        )
        descriptors = tuple(self._describe(start, segments) for start in starts)
        return (
            min(item.source_start for item in descriptors),
            max(item.close_at for item in descriptors),
        )

    @_datetime_boundary
    def selection_bounds(
        self, selected: BucketSelection
    ) -> tuple[datetime, datetime]:
        """紧凑身份集合的真实取数包络，不逐桶展开。

        Args: selected。
        """
        if not selected.count:
            raise ValueError("桶集合为空")
        segments = _segments(
            selected.first - _MARGIN, selected.last + _MARGIN, self.zone
        )
        identities = {
            endpoint
            for run in selected.runs
            for endpoint in (run.first, run.last)
        }
        # ⚠ 每个等差段内边界单调，额外纳入跳变两侧的跨边界 cell。
        for segment in segments[1:]:
            for moment in (segment.since - _EPSILON, segment.since):
                identity = self.align(moment)
                if selected.between(identity, identity).count:
                    identities.add(identity)
        descriptors = tuple(
            self._describe(identity, segments) for identity in identities
        )
        return (
            min(item.source_start for item in descriptors),
            max(item.close_at for item in descriptors),
        )


def _project(local: datetime, zone: ZoneInfo) -> datetime:
    """按 PostgreSQL 取较晚的 UTC 候选。

    Args: local, zone。
    """
    return max(
        local.replace(tzinfo=zone, fold=fold).astimezone(UTC) for fold in (0, 1)
    )


def _label(index: int, interval: timedelta) -> datetime:
    return BUCKET_ORIGIN + index * interval


def _offset(moment: datetime, zone: ZoneInfo) -> timedelta:
    """一个真实 UTC 时刻的当地偏移。

    Args: moment, zone。
    """
    offset = moment.astimezone(zone).utcoffset()
    if offset is None:
        raise ValueError("时区没有 UTC 偏移")
    return offset


def _transition(left: datetime, right: datetime, zone: ZoneInfo) -> datetime:
    """在偏移不同的两端之间定位跳变右开界。

    Args: left, right, zone。
    """
    before = _offset(left, zone)
    while right - left > _EPSILON:
        middle = left + ((right - left) // _EPSILON // 2) * _EPSILON
        if _offset(middle, zone) == before:
            left = middle
        else:
            right = middle
    return right


def _segments(
    since: datetime, until: datetime, zone: ZoneInfo
) -> tuple[_OffsetSegment, ...]:
    """按真实 UTC 偏移拆分区间。

    Args: since, until, zone。
    """
    since, until = to_utc(since), to_utc(until)
    found: list[_OffsetSegment] = []
    cursor, begin, offset = since, since, _offset(since, zone)
    while cursor < until:
        probe = min(cursor + _PROBE, until)
        following = _offset(probe, zone)
        if following != offset:
            edge = _transition(cursor, probe, zone)
            found.append(_OffsetSegment(begin, edge, offset))
            begin, offset = edge, following
        cursor = probe
    if begin < until:
        found.append(_OffsetSegment(begin, until, offset))
    return tuple(found)


def _reachable_indexes(
    segments: tuple[_OffsetSegment, ...],
    since: datetime,
    until: datetime,
    interval: timedelta,
) -> tuple[tuple[int, int], ...]:
    """真实 UTC 区间能覆盖的墙钟 cell 序号段。

    Args: segments, since, until, interval。
    """
    found: list[tuple[int, int]] = []
    for segment in segments:
        left, right = max(since, segment.since), min(until, segment.until)
        if left >= right:
            continue
        local_left = left.replace(tzinfo=None) + segment.offset
        local_right = right.replace(tzinfo=None) + segment.offset
        first = (local_left - BUCKET_ORIGIN) // interval
        last = (local_right - _EPSILON - BUCKET_ORIGIN) // interval
        found.append((first, last))
    merged: list[tuple[int, int]] = []
    for first, last in sorted(found):
        if merged and first <= merged[-1][1] + 1:
            merged[-1] = (merged[-1][0], max(last, merged[-1][1]))
        else:
            merged.append((first, last))
    return tuple(merged)


def _identity_runs(
    indexes: tuple[tuple[int, int], ...],
    segments: tuple[_OffsetSegment, ...],
    interval: timedelta,
) -> tuple[_IdentityRun, ...]:
    """按 PostgreSQL 偏移分段投影可达墙钟 cell。

    Args: indexes, segments, interval。
    """
    found: list[_IdentityRun] = []
    for index, segment in enumerate(segments):
        local_left = segment.since.replace(tzinfo=None) + segment.offset
        following = segments[index + 1] if index + 1 < len(segments) else None
        local_right = (
            following.since.replace(tzinfo=None) + following.offset
            if following is not None
            else segment.until.replace(tzinfo=None) + segment.offset
        )
        lower = -((BUCKET_ORIGIN - local_left) // interval)
        upper = -((BUCKET_ORIGIN - local_right) // interval) - 1
        for first, last in indexes:
            begin, end = max(first, lower), min(last, upper)
            if begin <= end:
                found.append(
                    _IdentityRun(
                        (_label(begin, interval) - segment.offset).replace(
                            tzinfo=UTC
                        ),
                        (_label(end, interval) - segment.offset).replace(
                            tzinfo=UTC
                        ),
                    )
                )
    return tuple(found)


def _merge_runs(
    runs: tuple[_IdentityRun, ...], interval: timedelta
) -> tuple[_IdentityRun, ...]:
    """合并同相位的重叠身份段，去除别名重复。

    Args: runs, interval。
    """
    phases: dict[timedelta, list[_IdentityRun]] = {}
    for run in runs:
        phase = (run.first - _UTC_ORIGIN) % interval
        phases.setdefault(phase, []).append(run)
    found: list[_IdentityRun] = []
    for group in phases.values():
        merged: list[_IdentityRun] = []
        for run in sorted(group, key=lambda item: item.first):
            if merged and run.first <= merged[-1].last + interval:
                merged[-1] = _IdentityRun(
                    merged[-1].first, max(merged[-1].last, run.last)
                )
            else:
                merged.append(run)
        found.extend(merged)
    return tuple(sorted(found, key=lambda item: item.first))


def _clip_run(
    run: _IdentityRun,
    first: datetime,
    last: datetime,
    interval: timedelta,
) -> _IdentityRun | None:
    """按 UTC 身份闭区间裁剪一段。

    Args: run, first, last, interval。
    """
    lower = max(0, -((run.first - first) // interval))
    upper = min(
        (run.last - run.first) // interval, (last - run.first) // interval
    )
    if lower > upper:
        return None
    return _IdentityRun(
        run.first + lower * interval, run.first + upper * interval
    )


def _preimages(
    local: datetime,
    interval: timedelta,
    segments: tuple[_OffsetSegment, ...],
) -> tuple[tuple[datetime, datetime], ...]:
    """墙钟 cell 与真实 UTC 偏移段的全部交集。

    Args: local, interval, segments。
    """
    found: list[tuple[datetime, datetime]] = []
    for segment in segments:
        first = (local - segment.offset).replace(tzinfo=UTC)
        last = (local + interval - segment.offset).replace(tzinfo=UTC)
        since, until = max(first, segment.since), min(last, segment.until)
        if since < until:
            found.append((since, until))
    return tuple(found)


def _subtract_run(
    run: _IdentityRun, excluded: _IdentityRun, interval: timedelta
) -> tuple[_IdentityRun, ...]:
    """从等差段减掉同相位身份。

    Args: run, excluded, interval。
    """
    if (run.first - excluded.first) % interval:
        return (run,)
    first, last = max(run.first, excluded.first), min(run.last, excluded.last)
    if first > last:
        return (run,)
    found: list[_IdentityRun] = []
    if run.first < first:
        found.append(_IdentityRun(run.first, first - interval))
    if last < run.last:
        found.append(_IdentityRun(last + interval, run.last))
    return tuple(found)
