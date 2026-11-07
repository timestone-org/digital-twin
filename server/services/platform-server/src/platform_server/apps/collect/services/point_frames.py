"""推送条目的组装：一个点位一条，客户端按 `nodeKey` 合并。

三条口径（DASHBOARD_DESIGN §4.3、runtime-resilience §9）：

1. **取不到就说取不到**：没有快照值一律 `state: "error"` 加原因，绝不推一条
   空值或零值冒充读数。
2. **值的新旧不由这里判**：`timestampMs` 照实是**采样时刻**，不用当前墙钟
   顶替，客户端要多新自己看。⚠ 不许按「时刻比现在旧多久」判陈旧：订阅只在
   值变化时回调，一个一天变一次的点位每天有 23 小时会被这种判法误标，而它
   的值一直是对的。采集停了则快照键跟着到期，落进第 1 条。
3. **条目自描述、按键合并**：全量帧与增量帧是同一种形状，客户端不必区分——
   前者只是恰好带上了整份点位清单。

⚠ 本模块住在 `apps/collect` 而不是 `apps/dashboard`：它的输入是 `PointReading`、
输出是点位条目，一个大屏名词也没有。大屏发布与采集配置页两条推送链路共用它，
放在其中一条那边会让另一条反向 import，而那是一个 import 期的环。
"""

import math
from collections.abc import Iterable, Mapping, Sequence
from typing import Any, cast

from lib.logging import get_logger
from platform_server.apps.collect.services.snapshot_source import PointReading

_logger = get_logger("platform.collect.frames")

# 条目的状态，闭合集合。⚠ 字符串不是数字：数字枚举在两个仓之间对不上号时
# 没有任何提示（api-contract §4.2）
POINT_STATE_OK = "ok"
POINT_STATE_ERROR = "error"
POINT_STATES: tuple[str, ...] = (POINT_STATE_ERROR, POINT_STATE_OK)

# 键名与前端 `@dt/contracts` 的 `PointSample` 同口径（camelCase）
KEY_NODE = "nodeKey"
KEY_STATE = "state"
KEY_VALUE = "value"
KEY_TIMESTAMP_MS = "timestampMs"
KEY_QUALITY = "quality"
KEY_ERROR = "errorMessage"

# 取不到的原因分开写，处置完全不同：「采集侧没报过它」去查点位配置，「我们读
# 不到」去看 Redis，「不是有限数」去查现场设备
MISSING_REASON = "点位暂无快照值，采集侧还没上报过它"
UNAVAILABLE_REASON = "点位快照暂时读不到"
NON_FINITE_REASON = "点位读数不是有限数，无法展示"

Item = dict[str, Any]


def build_items(
    node_keys: Sequence[str], readings: Mapping[str, PointReading]
) -> list[Item]:
    """按点位清单组装一批条目，顺序沿用清单。

    Args: node_keys, readings。
    """
    return [
        _item_of(node_key, readings.get(node_key)) for node_key in node_keys
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

    ⚠ 比的是整条条目而不只是值：状态从 `ok` 变 `error`、或者值没变而质量位
    变了，都是客户端必须知道的一次变化。
    Args: items, sent。
    """
    return [item for item in items if sent.get(_node_key_of(item)) != item]


def warn_non_finite(fresh: Iterable[Item], *, topic: str) -> None:
    """这批新变化里有非有限读数时按批记一条。

    ⚠ 只传与上一次推送不同的条目：值不变时它每拍都还在，逐拍记会淹没日志。
    Args: fresh, topic。
    """
    points = sum(item.get(KEY_ERROR) == NON_FINITE_REASON for item in fresh)
    if points:
        _logger.warning(
            "point_value_non_finite",
            "点位读数不是有限数，按取不到推送",
            topic=topic,
            points=points,
        )


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


def _item_of(node_key: str, reading: PointReading | None) -> Item:
    """一个点位的一条条目。

    Args: node_key, reading。
    """
    if reading is None:
        return _error_item(node_key, reason=MISSING_REASON)
    if not _is_finite(reading.value):
        return _error_item(node_key, reason=NON_FINITE_REASON)
    return {
        KEY_NODE: node_key,
        KEY_STATE: POINT_STATE_OK,
        KEY_VALUE: reading.value,
        # ⚠ 采样时刻，不是本拍的墙钟：换成墙钟，界面上「更新于」这一列就会
        # 对每一个点位都显示「刚刚」，而它本来是判断现场还动不动的唯一依据
        KEY_TIMESTAMP_MS: reading.timestamp_ms,
        KEY_QUALITY: reading.quality,
    }


def _is_finite(value: object) -> bool:
    """值里是否没有 NaN / Infinity，数组与对象逐层看。

    ⚠ 拦在这里而不是快照解码：hub 那一跳是严格 JSON，一个发不出去的值会让整批
    失败；而解码处拦掉会让点位状态也跟着变成「等待」，它其实采到了。
    Args: value。
    """
    if isinstance(value, float):
        return math.isfinite(value)
    if isinstance(value, list):
        return all(_is_finite(part) for part in cast("list[object]", value))
    if isinstance(value, dict):
        parts = cast("dict[str, object]", value).values()
        return all(_is_finite(part) for part in parts)
    return True


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
