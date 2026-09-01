"""每日增量的队列信封：编码、解码与投递。

⚠ 信封里必须带 `traceparent`：消息落进 Redis 再被另一个进程取出时，进程内的
上下文早就没了，漏了这一条链路会在「任务提交」处齐刷刷断掉
（docs/agents/observability.md §4.2）。
"""

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date

from lib.logging import current_traceparent
from lib.stream import StreamGroup, StreamLike
from platform_server.apps.hvac.services.ac_startup_daily import (
    format_business_date,
    parse_business_date,
)

# 信封版本。字段改形状时 +1，消费端据此拒掉读不懂的消息而不是猜
ENVELOPE_VERSION = "1"

_FIELD_VERSION = "envelope_version"
_FIELD_ROOM = "room_id"
_FIELD_DATE = "business_date"
_FIELD_TRACEPARENT = "traceparent"


@dataclass(frozen=True)
class DailyMessage:
    """一天一个房间的增量任务。

    ⚠ 区间不进信封，与分片消息同一个理由：参数一变，躺在队列里的老消息若带着
    旧区间，跑出来的就是两套规则混在一起的一批事件。消费端按当前规则重算。
    """

    room_id: uuid.UUID
    business_date: date
    traceparent: str

    def to_fields(self) -> dict[str, str]:
        """摊成扁平的字符串字段，便于用 redis-cli 直接看。"""
        return {
            _FIELD_VERSION: ENVELOPE_VERSION,
            _FIELD_ROOM: str(self.room_id),
            _FIELD_DATE: format_business_date(self.business_date),
            _FIELD_TRACEPARENT: self.traceparent,
        }


def build(room_id: uuid.UUID, day: date) -> DailyMessage:
    """现开一条链路并造一条消息。

    Args: room_id, day。
    """
    return DailyMessage(
        room_id=room_id,
        business_date=day,
        traceparent=current_traceparent(),
    )


def decode(fields: Mapping[str, str]) -> DailyMessage | None:
    """把流里的字段还原成任务；读不懂就给 None。

    ⚠ 读不懂的消息不能当成「跑完了」：调用方要把它记一条错误再确认丢弃，
    而不是静默跳过。

    Args: fields。
    """
    if fields.get(_FIELD_VERSION) != ENVELOPE_VERSION:
        return None
    traceparent = fields.get(_FIELD_TRACEPARENT)
    room_id = _as_uuid(fields.get(_FIELD_ROOM))
    day = parse_business_date(fields.get(_FIELD_DATE) or "")
    if room_id is None or day is None or not traceparent:
        return None
    return DailyMessage(
        room_id=room_id, business_date=day, traceparent=traceparent
    )


def _as_uuid(raw: str | None) -> uuid.UUID | None:
    if not raw:
        return None
    try:
        return uuid.UUID(raw)
    except ValueError:
        return None


async def publish_daily(
    stream: StreamLike,
    *,
    target: StreamGroup,
    messages: Sequence[DailyMessage],
) -> list[str]:
    """把一批日增量任务投进流，返回它们的条目 id。

    ⚠ 每条消息的 traceparent 由 `DailyMessage.to_fields` 带上；再加投递路径时
    信封里也必须有它，否则链路会在这一跳齐断。

    Args: stream, target, messages。
    """
    return [
        await stream.publish(target.stream, message.to_fields())
        for message in messages
    ]
