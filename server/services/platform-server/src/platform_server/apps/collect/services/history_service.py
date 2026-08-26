"""点位历史的读侧。**时序集合一律游标分页**（api-contract §5.1）。

页码分页在持续写入的表上会静默重复与漏行：`page=2` 与 `page=1` 之间新插入的
行会让某些行出现两次、另一些一次都不出现，而没有任何提示。
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from lib.errors.base import FieldError
from lib.utils.timeutils import to_utc
from lib.web import CursorPage, CursorParams, decode_cursor, encode_cursor
from lib.web.pagination import CURSOR_FIELD, MAX_PAGE_SIZE
from platform_server.apps.collect.crud import (
    HistoryCursor,
    HistorySource,
    HistoryWindow,
    PointRef,
    build_aggregate_query,
    build_range_query,
)
from platform_server.apps.collect.errors import HistoryQueryInvalid
from platform_server.apps.collect.schemas import (
    AGGREGATE_SQL,
    AGGREGATES,
    AggregateBucketOut,
    AggregateIn,
    AggregateOut,
    HistoryPointOut,
)
from timeseries import (
    InvalidNodeKey,
    compose_node_key,
    normalize_quality,
    read_value,
    split_node_key,
)

# 游标里的三个锚点键
_CURSOR_TS = "ts"
_CURSOR_SOURCE = "source_id"
_CURSOR_CODE = "point_code"


@dataclass(frozen=True)
class HistoryQuery:
    """一次历史查询的入参，已经过校验。"""

    node_keys: tuple[str, ...]
    range_start: datetime
    range_end: datetime


async def read_history(
    source: HistorySource, *, query: HistoryQuery, page: CursorParams
) -> CursorPage[HistoryPointOut]:
    """取一页历史读数。

    Args: source, query, page。
    """
    window = _window(query, row_limit=page.limit + 1)
    sql, params = build_range_query(window, _cursor_of(page.after))
    rows = await source.fetch_all(sql, params)
    has_more = len(rows) > page.limit
    readings = [_to_reading(row) for row in rows[: page.limit]]
    return CursorPage[HistoryPointOut](
        items=readings,
        next=_next_cursor(readings) if has_more else None,
        has_more=has_more,
    )


async def aggregate_history(
    source: HistorySource, *, payload: AggregateIn, default_timezone: str
) -> AggregateOut:
    """按窗口分桶聚合。

    Args: source, payload, default_timezone（业务时区的缺省口径）。
    """
    _reject_unknown_aggregate(payload.aggregate)
    _reject_empty_interval(payload.interval)
    timezone = payload.timezone or default_timezone
    _reject_unknown_timezone(timezone)
    query = build_query(
        node_keys=payload.node_keys,
        range_start=payload.range_start,
        range_end=payload.range_end,
    )
    window = _window(query, row_limit=_bucket_limit(payload))
    sql, params = build_aggregate_query(
        window,
        aggregate_sql=AGGREGATE_SQL[payload.aggregate],
        interval=_interval_of(payload.interval),
        timezone=timezone,
    )
    rows = await source.fetch_all(sql, params)
    return AggregateOut(
        items=[_to_bucket(row) for row in rows],
        interval=payload.interval,
        aggregate=payload.aggregate,
        timezone=timezone,
    )


def build_query(
    *,
    node_keys: Sequence[str],
    range_start: datetime,
    range_end: datetime,
) -> HistoryQuery:
    """校验一次查询的入参。区间必须双向有界且非空。

    Args: node_keys, range_start, range_end。
    """
    if range_end <= range_start:
        raise HistoryQueryInvalid(
            "查询区间为空",
            details=(
                FieldError(
                    field="range_end",
                    code="empty_range",
                    message="结束时刻必须晚于开始时刻",
                ),
            ),
        )
    for position, node_key in enumerate(node_keys):
        _reject_bad_node_key(position, node_key)
    return HistoryQuery(
        node_keys=tuple(node_keys),
        range_start=range_start,
        range_end=range_end,
    )


def parse_moment(raw: str, field: str) -> datetime:
    """把 query 里的时刻串解成带时区的 datetime。

    ⚠ 不接受 naive 时刻：没有时区的字符串一旦落进查询，就再也说不清它是哪个
    时区的了（api-contract §6）。
    Args: raw, field。
    """
    try:
        moment = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as error:
        raise HistoryQueryInvalid(
            "时刻格式不合法",
            details=(
                FieldError(
                    field=field,
                    code="invalid_format",
                    message="应为 RFC3339 时间，例如 2026-08-14T00:00:00Z",
                ),
            ),
        ) from error
    if moment.tzinfo is None:
        raise HistoryQueryInvalid(
            "时刻必须带时区",
            details=(
                FieldError(
                    field=field,
                    code="missing_timezone",
                    message="应为 UTC 时刻并以 Z 结尾",
                ),
            ),
        )
    return moment


def _reject_unknown_aggregate(aggregate: str) -> None:
    """聚合函数必须在白名单里。

    Args: aggregate。
    """
    if aggregate in AGGREGATES:
        return
    raise HistoryQueryInvalid(
        "不支持的聚合函数",
        details=(
            FieldError(
                field="aggregate",
                code="unsupported_aggregate",
                message=f"只支持：{'、'.join(AGGREGATES)}",
            ),
        ),
    )


def _reject_empty_interval(interval: str) -> None:
    """窗口宽度必须为正。

    ⚠ 入参的正则只管形状，`0s` 照样过得去；零宽窗口在库里是一句
    「interval must not be zero」，那会把一次输入错误报成 503。
    Args: interval。
    """
    if int(interval[:-1]) > 0:
        return
    raise HistoryQueryInvalid(
        "聚合窗口必须大于零",
        details=(
            FieldError(
                field="interval",
                code="empty_interval",
                message="窗口宽度要写成正数加单位，例如 15m",
            ),
        ),
    )


def _reject_unknown_timezone(timezone: str) -> None:
    """时区必须是系统认得的名字。

    ⚠ 它是用户可给的自由文本，直接进 `time_bucket` 的话，写错一个字母就是
    库里报错、对外 503，而这本该是一次 400。
    Args: timezone。
    """
    try:
        ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError) as error:
        raise HistoryQueryInvalid(
            "时区不合法",
            details=(
                FieldError(
                    field="timezone",
                    code="unknown_timezone",
                    message="应为 IANA 时区名，例如 Asia/Shanghai",
                ),
            ),
        ) from error


def _reject_bad_node_key(position: int, node_key: str) -> None:
    try:
        split_node_key(node_key)
    except InvalidNodeKey as error:
        raise HistoryQueryInvalid(
            "点位标识不合法",
            details=(
                FieldError(
                    field=f"node_keys[{position}]",
                    code="invalid_node_key",
                    message="应为 `{数据源 id}:{点位编码}`",
                ),
            ),
        ) from error


def _window(query: HistoryQuery, *, row_limit: int) -> HistoryWindow:
    return HistoryWindow(
        points=tuple(_point_ref(key) for key in query.node_keys),
        range_start=to_utc(query.range_start),
        range_end=to_utc(query.range_end),
        row_limit=row_limit,
    )


def _point_ref(node_key: str) -> PointRef:
    source_id, point_code = split_node_key(node_key)
    return PointRef(source_id=source_id, point_code=point_code)


def _bucket_limit(payload: AggregateIn) -> int:
    """一次聚合最多回多少桶。

    ⚠ 有上限不是可选项：`interval=1s` 加一个月的区间是两百多万桶，足以把
    一次「看看趋势」变成一次 OOM。
    Args: payload。
    """
    return MAX_PAGE_SIZE * len(payload.node_keys)


def _interval_of(interval: str) -> timedelta:
    """把 `15m` 这样的窗口翻成一段 `timedelta`。

    ⚠ 回 `timedelta` 而不是 `'15 minutes'`：它绑到 `CAST(:bucket_width AS
    interval)` 上，驱动按 interval 认这个占位符，字符串是当场 DataError。
    Args: interval。
    """
    units = {"s": "seconds", "m": "minutes", "h": "hours", "d": "days"}
    amount, unit = int(interval[:-1]), interval[-1]
    return timedelta(**{units[unit]: amount})


def _cursor_of(after: str | None) -> HistoryCursor | None:
    """把不透明游标解回锚点。

    ⚠ 里面的时刻要解成 `datetime`：它绑到 `(ts, …) > (:after_ts, …)` 上，驱动
    按 timestamptz 认这个占位符，字符串进不去。解不动的按「游标不可解析」拒绝，
    别漏成 500——游标是客户端随手就能改的入参。
    Args: after。
    """
    if after is None:
        return None
    payload = decode_cursor(after)
    return HistoryCursor(
        ts=_cursor_moment(payload.get(_CURSOR_TS, "")),
        source_id=payload.get(_CURSOR_SOURCE, ""),
        point_code=payload.get(_CURSOR_CODE, ""),
    )


def _cursor_moment(raw: str) -> datetime:
    """把游标里的时刻解回 UTC datetime。

    Args: raw。
    """
    try:
        moment = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as error:
        raise HistoryQueryInvalid(
            "游标不可解析",
            details=(
                FieldError(
                    field=CURSOR_FIELD,
                    code="invalid_cursor",
                    message="游标不可解析，请从上一页响应里原样带回",
                ),
            ),
        ) from error
    return to_utc(moment)


def _next_cursor(rows: Sequence[HistoryPointOut]) -> str:
    """把这一页最后一行编成下一页的锚点。

    ⚠ 只在「还有下一页」时调用，那时这一页必非空（limit ≥ 1）。
    ⚠ 时刻写 `isoformat()` 而不是对外那份 `format_rfc3339`：后者截到毫秒，
    带亚毫秒时刻的那一行会因为「锚点比自己小」在下一页里**再来一次**。游标
    是不透明的，精度只对自己负责。
    Args: rows。
    """
    last = rows[-1]
    source_id, point_code = split_node_key(last.node_key)
    return encode_cursor(
        {
            _CURSOR_TS: to_utc(last.ts).isoformat(),
            _CURSOR_SOURCE: str(source_id),
            _CURSOR_CODE: point_code,
        }
    )


def _to_reading(row: dict[str, object]) -> HistoryPointOut:
    """一行归档记录的对外形态。两列的解码走 domain 的唯一真源。

    Args: row。
    """
    return HistoryPointOut(
        node_key=compose_node_key(
            _as_uuid(row["source_id"]), str(row["point_code"])
        ),
        ts=_as_time(row["ts"]),
        value=read_value(_as_number(row["value_num"]), _as_text(row)),
        quality=normalize_quality(row["quality"]),
    )


def _to_bucket(row: dict[str, object]) -> AggregateBucketOut:
    """一个聚合桶的对外形态。

    Args: row。
    """
    return AggregateBucketOut(
        node_key=compose_node_key(
            _as_uuid(row["source_id"]), str(row["point_code"])
        ),
        bucket_start=_as_time(row["bucket_start"]),
        value=_as_number(row["bucket_value"]),
        sample_count=int(str(row["sample_count"])),
    )


def _as_uuid(value: object) -> uuid.UUID:
    return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))


def _as_time(value: object) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value))


def _as_number(value: object) -> float | None:
    return float(value) if isinstance(value, int | float) else None


def _as_text(row: dict[str, object]) -> str | None:
    value = row.get("value_text")
    return str(value) if isinstance(value, str) else None
