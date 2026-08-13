"""训练任务的队列信封：编码、解码与投递。

⚠ 消息只带 `model_id` 不带配置快照：以行为准，改配置后的重复旧消息训出来
的就是新配置的结果——这正是幂等消费想要的收敛方向。
⚠ 信封里必须带 `traceparent`（docs/agents/observability.md §4.2）。
"""

import uuid
from collections.abc import Mapping
from dataclasses import dataclass

from platform_server.apps.hvac.services.ac_startup_queue import (
    current_traceparent,
)
from platform_server.stream import StreamGroup, StreamLike

# 信封版本。字段改形状时 +1，消费端据此拒掉读不懂的消息而不是猜
ENVELOPE_VERSION = "1"

_FIELD_VERSION = "envelope_version"
_FIELD_MODEL = "model_id"
_FIELD_TRACEPARENT = "traceparent"


@dataclass(frozen=True)
class TrainMessage:
    """一次训练任务。"""

    model_id: uuid.UUID
    traceparent: str

    def to_fields(self) -> dict[str, str]:
        """摊成扁平的字符串字段，便于用 redis-cli 直接看。"""
        return {
            _FIELD_VERSION: ENVELOPE_VERSION,
            _FIELD_MODEL: str(self.model_id),
            _FIELD_TRACEPARENT: self.traceparent,
        }


def new_message(model_id: uuid.UUID) -> TrainMessage:
    """当前链路上的一条训练消息。

    Args: model_id。
    """
    return TrainMessage(model_id=model_id, traceparent=current_traceparent())


def decode(fields: Mapping[str, str]) -> TrainMessage | None:
    """把流里的字段还原成任务；读不懂就给 None。

    ⚠ 读不懂的消息不能当成「跑完了」：调用方要记日志再确认丢弃。
    Args: fields。
    """
    if fields.get(_FIELD_VERSION) != ENVELOPE_VERSION:
        return None
    traceparent = fields.get(_FIELD_TRACEPARENT)
    raw = fields.get(_FIELD_MODEL)
    if not raw or not traceparent:
        return None
    try:
        model_id = uuid.UUID(raw)
    except ValueError:
        return None
    return TrainMessage(model_id=model_id, traceparent=traceparent)


async def publish_training(
    stream: StreamLike, *, target: StreamGroup, message: TrainMessage
) -> str:
    """把一条训练任务投进流，返回条目 id。

    ⚠ 必须在事务**提交之后**投递（同 `publish_shards` 的教训）：提交前投出
    去，消费者可能先于提交读到模型行还不存在。
    ⚠ 消息的 traceparent 由 `TrainMessage.to_fields` 带上，漏了它链路在
    这一跳齐断。
    Args: stream, target, message。
    """
    return await stream.publish(target.stream, message.to_fields())
