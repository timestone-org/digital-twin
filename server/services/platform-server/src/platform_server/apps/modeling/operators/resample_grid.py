"""建模重采样的墙钟网格与桶的真实 UTC 边界。"""

from bisect import bisect_right
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from platform_server.apps.dataset.services import offset_segments
from platform_server.apps.modeling.operators.base import OperatorError

_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
_MS = timedelta(milliseconds=1)
_DAY_MS = 86_400_000
_HOUR_MS = 3_600_000


@dataclass(frozen=True)
class Bounds:
    """桶在 UTC 上的左闭右开区间和墙钟标签。"""

    start: int
    end: int
    label: int


@dataclass(frozen=True)
class Bucket:
    """含样本的桶。"""

    bounds: Bounds
    positions: list[int]


@dataclass(frozen=True)
class _Span:
    start: int
    end: int
    offset: int


def buckets_of(
    index: tuple[int, ...],
    width: int,
    *,
    offset_minutes: int,
    zone: ZoneInfo | None,
) -> list[Bucket]:
    """按时间桶与行时刻稳定排序。Args: index, width, offset_minutes, zone。"""
    if not index:
        return []
    grouped = (
        _fixed_buckets(index, width, offset_minutes * 60_000)
        if zone is None
        else _named_buckets(index, width, zone)
    )
    return [
        Bucket(bounds, sorted(positions, key=index.__getitem__))
        for bounds, positions in sorted(
            grouped.items(), key=lambda item: item[0].start
        )
    ]


def _fixed_buckets(
    index: tuple[int, ...], width: int, offset_ms: int
) -> dict[Bounds, list[int]]:
    grouped: dict[Bounds, list[int]] = {}
    for position, moment in enumerate(index):
        label = ((moment + offset_ms) // width) * width
        start = label - offset_ms
        grouped.setdefault(Bounds(start, start + width, label), []).append(
            position
        )
    return grouped


def _offset_spans(index: tuple[int, ...], zone: ZoneInfo) -> list[_Span]:
    # IANA 的偏移变化最多一整天，两侧留出完整的桶与转换区间。
    try:
        since = _EPOCH + (min(index) - 2 * _DAY_MS) * _MS
        until = _EPOCH + (max(index) + 2 * _DAY_MS) * _MS
        segments = offset_segments(since, until, zone)
    except (OverflowError, ValueError) as error:
        raise OperatorError("输入时刻无法对齐完整的业务时间桶") from error
    return [
        _Span(
            (segment.since - _EPOCH) // _MS,
            (segment.until - _EPOCH) // _MS,
            segment.offset // _MS,
        )
        for segment in segments
    ]


def _named_buckets(
    index: tuple[int, ...], width: int, zone: ZoneInfo
) -> dict[Bounds, list[int]]:
    spans = _offset_spans(index, zone)
    starts = [span.start for span in spans]
    labels: dict[int, list[Bounds]] = {}
    grouped: dict[Bounds, list[int]] = {}
    for position, moment in enumerate(index):
        active = spans[bisect_right(starts, moment) - 1]
        label = ((moment + active.offset) // width) * width
        bounds = labels.get(label)
        if bounds is None:
            bounds = _label_bounds(label, width, spans, starts)
            labels[label] = bounds
        for bucket in bounds:
            if bucket.start <= moment < bucket.end:
                grouped.setdefault(bucket, []).append(position)
                break
        else:
            raise OperatorError("输入时刻没有可用的业务时间桶")
    return grouped


def _label_bounds(
    label: int, width: int, spans: list[_Span], starts: list[int]
) -> list[Bounds]:
    first = max(0, bisect_right(starts, label - _DAY_MS) - 1)
    past_last = bisect_right(starts, label + width + _DAY_MS)
    pieces = [
        _Span(
            max(span.start, label - span.offset),
            min(span.end, label + width - span.offset),
            span.offset,
        )
        for span in spans[first:past_last]
        if span.start < label + width - span.offset
        and label - span.offset < span.end
    ]
    if width > _HOUR_MS:
        return [Bounds(pieces[0].start, pieces[-1].end, label)]
    return _short_bounds(pieces, label)


def _short_bounds(pieces: list[_Span], label: int) -> list[Bounds]:
    """回拨后的重复小时保留独立的真实桶。Args: pieces, label。"""
    available: list[_Span] = []
    for piece in pieces:
        if (
            available
            and available[-1].end == piece.start
            and available[-1].offset <= piece.offset
        ):
            available[-1] = _Span(available[-1].start, piece.end, piece.offset)
        else:
            available.append(piece)
    return [Bounds(piece.start, piece.end, label) for piece in available]
