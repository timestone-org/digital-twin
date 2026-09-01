"""抽取分片的队列信封：编码、解码与投递。

⚠ 信封里必须带 `traceparent`：消息落进 Redis 再被另一个进程取出时，进程内的
上下文早就没了，漏了这一条链路会在「任务提交」处齐刷刷断掉
（docs/agents/observability.md §4.2）。
"""

import uuid
from collections.abc import Mapping
from dataclasses import dataclass

from lib.stream import StreamGroup, StreamLike

# 信封版本。字段改形状时 +1，消费端据此拒掉读不懂的消息而不是猜
ENVELOPE_VERSION = "1"

_FIELD_VERSION = "envelope_version"
_FIELD_BATCH = "batch_id"
_FIELD_ROOM = "room_id"
_FIELD_MONTH = "month"
_FIELD_TRACEPARENT = "traceparent"


@dataclass(frozen=True)
class ShardMessage:
    """一片抽取任务。取数区间由消费端按当前规则重算，不进信封。

    ⚠ 区间不进信封是刻意的：参数一变，躺在队列里的老消息若带着旧区间，
    跑出来的就是两套规则混在一起的一批事件。
    """

    batch_id: uuid.UUID
    room_id: uuid.UUID
    month: str
    traceparent: str

    def to_fields(self) -> dict[str, str]:
        """摊成扁平的字符串字段，便于用 redis-cli 直接看。"""
        return {
            _FIELD_VERSION: ENVELOPE_VERSION,
            _FIELD_BATCH: str(self.batch_id),
            _FIELD_ROOM: str(self.room_id),
            _FIELD_MONTH: self.month,
            _FIELD_TRACEPARENT: self.traceparent,
        }


def decode(fields: Mapping[str, str]) -> ShardMessage | None:
    """把流里的字段还原成任务；读不懂就给 None。

    ⚠ 读不懂的消息不能当成「跑完了」：调用方要把它记成失败，而不是静默丢掉。
    Args: fields。
    """
    if fields.get(_FIELD_VERSION) != ENVELOPE_VERSION:
        return None
    month = fields.get(_FIELD_MONTH)
    traceparent = fields.get(_FIELD_TRACEPARENT)
    batch_id = _as_uuid(fields.get(_FIELD_BATCH))
    room_id = _as_uuid(fields.get(_FIELD_ROOM))
    if batch_id is None or room_id is None or not month or not traceparent:
        return None
    return ShardMessage(
        batch_id=batch_id,
        room_id=room_id,
        month=month,
        traceparent=traceparent,
    )


def _as_uuid(raw: str | None) -> uuid.UUID | None:
    if not raw:
        return None
    try:
        return uuid.UUID(raw)
    except ValueError:
        return None


async def publish_shards(
    stream: StreamLike, *, target: StreamGroup, messages: list[ShardMessage]
) -> list[str]:
    """把一批分片任务投进流，返回它们的条目 id。

    ⚠ 必须在事务**提交之后**投递：提交前投出去，消费者可能先于提交读到批次
    行还不存在，而那是一个取决于调度时机的间歇性缺陷。
    ⚠ 每条消息的 traceparent 由 `ShardMessage.to_fields` 带上；再加投递路径时
    信封里也必须有它，否则链路会在这一跳齐断。
    Args: stream, target, messages。
    """
    return [
        await stream.publish(target.stream, message.to_fields())
        for message in messages
    ]
