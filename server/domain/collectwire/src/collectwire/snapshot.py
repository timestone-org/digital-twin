"""点位当前值的快照线形：一个数据源一个 Redis 哈希键。

collector 写、platform-publisher 读（docs/DASHBOARD_DESIGN.md §6）。
⚠ 字段名漂了不会报错，只会让发布循环「什么都读不到」——而空结果与「现在
确实没有值」分不开。
"""

from uuid import UUID

SNAPSHOT_KEY_PREFIX = "collect:snapshot"

# 哈希的字段名是 point_code，字段值是这三项组成的 JSON 对象
FIELD_VALUE = "value"
FIELD_TIMESTAMP_MS = "ts_ms"
FIELD_QUALITY = "quality"
SNAPSHOT_FIELDS = (FIELD_QUALITY, FIELD_TIMESTAMP_MS, FIELD_VALUE)


def snapshot_key(source_id: UUID) -> str:
    """一个数据源的快照键。

    Args: source_id。
    """
    return f"{SNAPSHOT_KEY_PREFIX}:{source_id}"
