"""桶对齐与行幂等：Python 这一侧的分桶必须与 SQL 的 `time_bucket` 一格不差。

⚠ 这是台账里最容易静默写歪的一处（docs/DATASET_DESIGN.md §4.5.1）：SQL 按一种
边界分桶、Python 按另一种算水位时，行会成批落进**隔壁那一格**，而数值本身合法，
没有任何一处会报错。故两侧同取 `PLATFORM_DATASET_BUCKET_TIMEZONE`，且这里的
`bucket_start` 与 `time_bucket(…, timezone => …)` 的算法逐字相同。
"""

import uuid
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

# `time_bucket(…, timezone => …)` 的对齐原点。⚠ **是 2000-01-03（周一）而不是
# 2000-01-01**，且对全部桶宽都如此，不只是周宽。两个原点差 2 天 = 172800 秒，
# 故整除它的桶宽（1s / 1min / 1h / 1d 这些）两种取法算出来一模一样，而 7 分钟、
# 7 小时这类不整除的桶宽会整体错开固定的一段——界面上看不出任何异常。
# 真值由 tests/integration 里的桶对齐用例对着真库逐格比对钉死。
BUCKET_ORIGIN = datetime(2000, 1, 3)  # noqa: DTZ001 —— 原点是本地墙钟，不带时区

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


def bucket_start(
    moment: datetime, *, interval: timedelta, timezone: str
) -> datetime:
    """这一刻落在哪个桶里，回桶起点（UTC aware）。

    ⚠ 算法与 `time_bucket(…, timezone => …)` 逐字相同：先换成该时区的**墙钟**
    时刻，在墙钟上按 `BUCKET_ORIGIN` 取整，再换回 UTC。中间一律用不带时区的
    本地时刻——拿带时区的时刻做减法算的是绝对时长，跨夏令时会与 PG 差一小时。
    Args: moment, interval, timezone。
    """
    zone = ZoneInfo(timezone)
    local = moment.astimezone(zone).replace(tzinfo=None)
    steps = (local - BUCKET_ORIGIN) // interval
    return _to_utc(BUCKET_ORIGIN + steps * interval, zone)


def shift_bucket(
    bucket: datetime, *, steps: int, interval: timedelta, timezone: str
) -> datetime:
    """往前或往后数 `steps` 个桶。

    ⚠ 在**墙钟**上加减，不是在 UTC 上：桶是按本地时刻对齐的，跨夏令时那一天的
    相邻两个桶在绝对时间上并不相差一个桶宽。
    Args: bucket, steps, interval, timezone。
    """
    zone = ZoneInfo(timezone)
    local = bucket.astimezone(zone).replace(tzinfo=None) + steps * interval
    return _to_utc(local, zone)


def bucket_sequence(
    first: datetime, last: datetime, *, interval: timedelta, timezone: str
) -> tuple[datetime, ...]:
    """从 `first` 到 `last`（含）的全部桶起点，升序。

    Args: first, last, interval, timezone。
    """
    zone = ZoneInfo(timezone)
    moment = first.astimezone(zone).replace(tzinfo=None)
    end = last.astimezone(zone).replace(tzinfo=None)
    found: list[datetime] = []
    while moment <= end:
        found.append(_to_utc(moment, zone))
        moment += interval
    return tuple(found)


def collected_row_id(table_id: uuid.UUID, bucket: datetime) -> uuid.UUID:
    """采集写出的那一行的标识，由桶身份派生（D2）。

    ⚠ ISO 串强制 UTC：`+08:00` 与 `Z` 两种写法会算出两个不同的 id，于是同一个
    桶长出两行，而两行看起来都对。
    Args: table_id, bucket。
    """
    stamp = bucket.astimezone(UTC).isoformat()
    return uuid.uuid5(ROW_NAMESPACE, f"{table_id}|{stamp}|{COLLECT_SOURCE}")


def _to_utc(local: datetime, zone: ZoneInfo) -> datetime:
    """把一个本地墙钟时刻挂上时区再换成 UTC。

    ⚠ `fold=1` 不是可选项：秋季回拨那一小时的本地时刻出现两次，而 PG 的
    `AT TIME ZONE` 取的是**后一次**（回拨之后的标准时）。Python 默认 `fold=0`
    取前一次，于是那一小时里的桶会整体比 PG 早一小时——一年只错一小时，
    而那一小时的数看起来完全正常。
    Args: local, zone。
    """
    return local.replace(tzinfo=zone, fold=1).astimezone(UTC)
