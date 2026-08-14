"""推送条目的组装：一个点位一条，客户端按 `nodeKey` 合并。

三条口径（DASHBOARD_DESIGN §4.3、runtime-resilience §9）：

1. **取不到就说取不到**：没有快照值一律 `state: "error"` 加原因，绝不推一条
   空值或零值冒充读数。
2. **陈旧必须标注为陈旧**：值太旧时照推，但标 `state: "stale"`，且
   `timestampMs` 照实是**旧值**的时刻，不用当前墙钟顶替。
3. **条目自描述、按键合并**：全量帧与增量帧是同一种形状，客户端不必区分——
   前者只是恰好带上了本屏全部点位。
"""

from collections.abc import Iterable, Mapping, Sequence
from typing import Any

from lib.utils.timeutils import utcnow
from platform_server.apps.collect.services import PointReading

# 条目的状态，闭合集合。⚠ 字符串不是数字：数字枚举在两个仓之间对不上号时
# 没有任何提示（api-contract §4.2）
POINT_STATE_OK = "ok"
POINT_STATE_STALE = "stale"
POINT_STATE_ERROR = "error"
POINT_STATES: tuple[str, ...] = (
    POINT_STATE_ERROR,
    POINT_STATE_OK,
    POINT_STATE_STALE,
)

# 键名与前端 `@dt/contracts` 的 `PointSample` 同口径（camelCase）
KEY_NODE = "nodeKey"
KEY_STATE = "state"
KEY_VALUE = "value"
KEY_TIMESTAMP_MS = "timestampMs"
KEY_QUALITY = "quality"
KEY_ERROR = "errorMessage"

# 两种取不到的原因，分开写：一个是「采集侧没报过它」，一个是「我们读不到」，
# 处置完全不同——前者去查点位配置，后者去看 Redis
MISSING_REASON = "点位暂无快照值，采集侧还没上报过它"
UNAVAILABLE_REASON = "点位快照暂时读不到"

MS_PER_S = 1000

Item = dict[str, Any]


def now_ms() -> int:
    """当前 UTC 毫秒。发布循环用它判断陈旧。"""
    return int(utcnow().timestamp() * MS_PER_S)


def build_items(
    node_keys: Sequence[str],
    readings: Mapping[str, PointReading],
    *,
    at_ms: int,
    stale_after_ms: int,
) -> list[Item]:
    """按点位清单组装一批条目，顺序沿用清单。

    Args: node_keys, readings, at_ms（本拍的墙钟）, stale_after_ms。
    """
    return [
        _item_of(
            node_key,
            readings.get(node_key),
            at_ms=at_ms,
            stale_after_ms=stale_after_ms,
        )
        for node_key in node_keys
    ]


def error_items(node_keys: Iterable[str], *, reason: str) -> list[Item]:
    """整批标成取不到。快照读失败时用它，不许安静地什么都不推。

    Args: node_keys, reason。
    """
    return [_error_item(node_key, reason=reason) for node_key in node_keys]


def changed_items(
    items: Sequence[Item], sent: Mapping[str, Item]
) -> list[Item]:
    """只留与上一次推送不同的条目。

    ⚠ 比的是整条条目而不只是值：状态从 `ok` 变 `stale` 时值可能一字未改，
    而那正是客户端最需要知道的一次变化。
    Args: items, sent。
    """
    return [item for item in items if sent.get(_node_key_of(item)) != item]


def shards(items: Sequence[Item], size: int) -> list[list[Item]]:
    """按上限切片。

    ⚠ 分片在推送方做：hub 超限直接 413 且不替谁拆（ADR-0007）。
    Args: items, size。
    """
    return [
        list(items[start : start + size])
        for start in range(0, len(items), size)
    ]


def index_by_node_key(items: Iterable[Item]) -> dict[str, Item]:
    """把一批条目按点位身份索引，供下一拍比对。

    Args: items。
    """
    return {_node_key_of(item): item for item in items}


def _item_of(
    node_key: str,
    reading: PointReading | None,
    *,
    at_ms: int,
    stale_after_ms: int,
) -> Item:
    """一个点位的一条条目。

    Args: node_key, reading, at_ms, stale_after_ms。
    """
    if reading is None:
        return _error_item(node_key, reason=MISSING_REASON)
    is_stale = at_ms - reading.timestamp_ms > stale_after_ms
    return {
        KEY_NODE: node_key,
        KEY_STATE: POINT_STATE_STALE if is_stale else POINT_STATE_OK,
        KEY_VALUE: reading.value,
        # ⚠ 陈旧时它仍是旧值的时刻：换成当前墙钟就等于把陈旧值伪装成新值
        KEY_TIMESTAMP_MS: reading.timestamp_ms,
        KEY_QUALITY: reading.quality,
    }


def _error_item(node_key: str, *, reason: str) -> Item:
    """一条「取不到」。⚠ 不带 `value`：带一个 null 会被读成「现场报了空值」。

    Args: node_key, reason。
    """
    return {
        KEY_NODE: node_key,
        KEY_STATE: POINT_STATE_ERROR,
        KEY_ERROR: reason,
    }


def _node_key_of(item: Mapping[str, Any]) -> str:
    node_key = item.get(KEY_NODE)
    return node_key if isinstance(node_key, str) else ""
