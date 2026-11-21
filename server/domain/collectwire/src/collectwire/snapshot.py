"""点位当前值的快照线形：一个数据源一个 Redis 哈希键。

collector 写、platform-publisher 读（docs/DASHBOARD_DESIGN.md §6）。
⚠ 字段名漂了不会报错，只会让发布循环「什么都读不到」——而空结果与「现在
确实没有值」分不开。
"""

from hashlib import sha256
from uuid import UUID

COLLECT_LEASE_KEY = "collect:leader"
SNAPSHOT_KEY_PREFIX = "collect:snapshot"
SNAPSHOT_OWNERS_KEY_PREFIX = "collect:snapshot-owners"

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


def snapshot_owners_key(source_id: UUID) -> str:
    """一个数据源的逐点位快照属主键。Args: source_id。"""
    return f"{SNAPSHOT_OWNERS_KEY_PREFIX}:{source_id}"


def snapshot_owner_stamp(token: str, payload: str) -> str:
    """把原始快照字节与当前租约绑定。Args: token, payload。"""
    return f"{token}:{sha256(payload.encode('utf-8')).hexdigest()}"
