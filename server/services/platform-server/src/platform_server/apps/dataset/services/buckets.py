"""台账的墙钟桶起点、SQL 表达式与幂等行标识。

桶身份与 DST 解析见 docs/DATASET_DESIGN.md §4.5。
"""

import uuid
from datetime import datetime, timedelta

from lib.utils.timeutils import to_utc
from platform_server.apps.dataset.services.bucket_grid import (
    BUCKET_ORIGIN as WALL_ORIGIN,
)
from platform_server.apps.dataset.services.bucket_grid import (
    BucketDescriptor,
    BucketGrid,
    BucketSelection,
)

BUCKET_ORIGIN = WALL_ORIGIN

# 桶身份派生行标识的命名空间（D2）。⚠ **写成字面量定死**：改命名空间或改下面的
# 构造式 = 主键漂移，每个历史桶会再长出一行，全程不报错
ROW_NAMESPACE = uuid.uuid5(
    uuid.NAMESPACE_URL, "https://digitaltwin.local/dataset/collect"
)
# 采集写出的行的来源标记，同时进 `row_id` 的构造式
COLLECT_SOURCE = "collect"


def bucket_interval(interval_ms: int) -> timedelta:
    """台账周期的时长形态。

    Args: interval_ms。
    """
    return timedelta(milliseconds=interval_ms)


def build_bucket_expression() -> str:
    """台账 SQL 的墙钟取整与 PostgreSQL 时区解析表达式。"""
    # ⚠ timestamp 重载保留墙钟桶身份，DST 解析显式交给 PostgreSQL。
    return (
        "time_bucket(CAST(:bucket_width AS interval),"
        " ts AT TIME ZONE :bucket_timezone) AT TIME ZONE :bucket_timezone"
    )


def bucket_start(
    moment: datetime, *, interval: timedelta, timezone: str
) -> datetime:
    """墙钟取整后按 PostgreSQL 解析，保留既定桶身份。

    Args: moment, interval, timezone。
    """
    return BucketGrid(interval, timezone).align(moment)


def shift_bucket(
    bucket: datetime, *, steps: int, interval: timedelta, timezone: str
) -> datetime:
    """按可达身份严格前后移动，不重新取整身份。

    Args: bucket, steps, interval, timezone。
    """
    return BucketGrid(interval, timezone).shift(bucket, steps)


def bucket_sequence(
    first: datetime, last: datetime, *, interval: timedelta, timezone: str
) -> tuple[datetime, ...]:
    """身份闭区间内的可达桶，严格升序且不重复。

    Args: first, last, interval, timezone。
    """
    return BucketGrid(interval, timezone).sequence(first, last)


def describe_bucket(
    bucket: datetime, *, interval: timedelta, timezone: str
) -> BucketDescriptor:
    """一个身份的完整真实样本边界。

    Args: bucket, interval, timezone。
    """
    return BucketGrid(interval, timezone).describe(bucket)


def last_closed_bucket(
    now: datetime, *, interval: timedelta, timezone: str
) -> datetime:
    """最小尚未关闭身份之前的桶。

    Args: now, interval, timezone。
    """
    return BucketGrid(interval, timezone).last_closed(now)


def identity_floor(
    key: datetime, *, interval: timedelta, timezone: str
) -> datetime:
    """不晚于身份键的最后一个可达桶。

    Args: key, interval, timezone。
    """
    return BucketGrid(interval, timezone).floor(key)


def identity_ceil(
    key: datetime, *, interval: timedelta, timezone: str
) -> datetime:
    """不早于身份键的第一个可达桶。

    Args: key, interval, timezone。
    """
    return BucketGrid(interval, timezone).ceil(key)


def identities_for_span(
    since: datetime, until: datetime, *, interval: timedelta, timezone: str
) -> BucketSelection:
    """与真实 UTC 请求闭区间相交的紧凑桶身份集合。

    Args: since, until, interval, timezone。
    """
    return BucketGrid(interval, timezone).identities_for_span(since, until)


def count_buckets(
    first: datetime,
    last: datetime,
    *,
    interval: timedelta,
    timezone: str,
    ceiling: int,
) -> int:
    """身份闭区间的桶数，最多返回 ceiling + 1。

    Args: first, last, interval, timezone, ceiling。
    """
    return BucketGrid(interval, timezone).count(first, last, ceiling)


def collected_row_id(table_id: uuid.UUID, bucket: datetime) -> uuid.UUID:
    """采集写出的那一行的标识，由桶身份派生（D2）。

    ⚠ ISO 串强制 UTC：`+08:00` 与 `Z` 两种写法会算出两个不同的 id，于是同一个
    桶长出两行，而两行看起来都对。
    Args: table_id, bucket。
    """
    stamp = to_utc(bucket).isoformat()
    return uuid.uuid5(ROW_NAMESPACE, f"{table_id}|{stamp}|{COLLECT_SOURCE}")
