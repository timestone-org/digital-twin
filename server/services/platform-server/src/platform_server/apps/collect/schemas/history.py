"""点位历史读侧的入参与出参。

时序集合一律游标分页：页码分页在持续写入的表上会静默重复与漏行
（api-contract §5.1）。
"""

from typing import Annotated, Any

from pydantic import Field, StringConstraints

from platform_server.apps.collect.schemas.common import (
    InputModel,
    NodeKey,
    OutputModel,
    Utc,
)
from timeseries import Quality

# 一次查询最多问多少个点位。⚠ 上限不是为了省内存：谓词是字面量数组，太长会让
# 计划器放弃索引扫描
MAX_NODE_KEYS = 50

# 聚合窗口，字符串枚举（禁数字枚举）。取值直接进 `time_bucket` 的 interval
AggregateInterval = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, pattern=r"^\d{1,4}(s|m|h|d)$", max_length=8
    ),
]

# 聚合函数的白名单。⚠ 拼进 SQL 之前必须过它——这是唯一一处标识符不是绑定参数
AGGREGATES: tuple[str, ...] = ("avg", "count", "max", "min", "sum")

AGGREGATE_SQL: dict[str, str] = {
    "avg": "avg(value_num)",
    "count": "count(value_num)",
    "max": "max(value_num)",
    "min": "min(value_num)",
    "sum": "sum(value_num)",
}


class HistoryPointOut(OutputModel):
    """一条历史读数。

    ⚠ `value` 是测量值走 JSON number，不包 string：传感器精度本来就低于
    float64，包一层是纯负担（api-contract §6）。
    """

    node_key: str
    ts: Utc
    value: Any
    quality: Quality


class AggregateBucketOut(OutputModel):
    """一个聚合桶。`bucket_start` 是桶的左端点，按业务时区对齐。"""

    node_key: str
    bucket_start: Utc
    value: float | None
    sample_count: int


class AggregateIn(InputModel):
    """一次聚合查询。

    ⚠ `timezone` 会回显在出参里：不带时区的 `time_bucket` 按 UNIX 纪元对齐，
    东八区的日桶会从当地 08:00 开始，07:00 的数据落进前一天
    （docs/COLLECT_DESIGN.md §6）。
    """

    node_keys: list[NodeKey] = Field(min_length=1, max_length=MAX_NODE_KEYS)
    range_start: Utc
    range_end: Utc
    interval: AggregateInterval
    aggregate: str = Field(default="avg")
    timezone: str | None = None


class AggregateOut(OutputModel):
    """一次聚合的结果，回显它用的口径。"""

    items: list[AggregateBucketOut]
    interval: str
    aggregate: str
    timezone: str
