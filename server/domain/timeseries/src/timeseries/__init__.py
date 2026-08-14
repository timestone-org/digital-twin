"""点位历史的结构契约与值编解码。采集侧写、平台侧读，两侧引用同一份口径。

零 ORM 模型、零 CRUD、零 IO——只有纯函数与常量，约束见 ADR-0004。
"""

from timeseries.node_key import (
    SEPARATOR,
    InvalidNodeKey,
    compose_node_key,
    split_node_key,
)
from timeseries.quality import (
    FALLBACK_QUALITY,
    QUALITIES,
    Quality,
    normalize_quality,
)
from timeseries.schema import (
    CHUNK_INTERVAL,
    HISTORY_COLUMNS,
    HISTORY_SCHEMA,
    HISTORY_TABLE,
    PRIMARY_KEY_COLUMNS,
    SEGMENT_BY,
    TIME_COLUMN,
)
from timeseries.value import read_value, split_value

__all__ = [
    "CHUNK_INTERVAL",
    "FALLBACK_QUALITY",
    "HISTORY_COLUMNS",
    "HISTORY_SCHEMA",
    "HISTORY_TABLE",
    "PRIMARY_KEY_COLUMNS",
    "QUALITIES",
    "SEGMENT_BY",
    "SEPARATOR",
    "TIME_COLUMN",
    "InvalidNodeKey",
    "Quality",
    "compose_node_key",
    "normalize_quality",
    "read_value",
    "split_node_key",
    "split_value",
]
