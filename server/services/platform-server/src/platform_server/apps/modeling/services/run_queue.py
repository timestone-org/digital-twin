"""运行任务的队列信封：编码、解码与投递。

⚠ 消息只带 `run_id` 不带图快照：图已经冻结在运行行上（D6），信封里再抄一份
就有两个真源，而它们会漂。
⚠ 信封里必须带 `traceparent`（docs/agents/observability.md §4.2），否则链路在
异步这一跳齐断。
"""

import uuid
from collections.abc import Mapping
from dataclasses import dataclass

from lib.logging import current_traceparent
from lib.stream import StreamGroup, StreamLike

# 信封版本。字段改形状时 +1，消费端据此拒掉读不懂的消息而不是猜
ENVELOPE_VERSION = "1"

_FIELD_VERSION = "envelope_version"
_FIELD_RUN = "run_id"
_FIELD_TRACEPARENT = "traceparent"


@dataclass(frozen=True)
class RunMessage:
    """一次待执行的运行。"""

    run_id: uuid.UUID
    traceparent: str

    def to_fields(self) -> dict[str, str]:
        """摊成扁平的字符串字段，便于用 redis-cli 直接看。"""
        return {
            _FIELD_VERSION: ENVELOPE_VERSION,
            _FIELD_RUN: str(self.run_id),
            _FIELD_TRACEPARENT: self.traceparent,
        }


def new_message(run_id: uuid.UUID) -> RunMessage:
    """当前链路上的一条运行消息。

    Args: run_id。
    """
    return RunMessage(run_id=run_id, traceparent=current_traceparent())


def decode(fields: Mapping[str, str]) -> RunMessage | None:
    """把流里的字段还原成任务；读不懂就给 None。

    ⚠ 读不懂的消息不能当成「跑完了」：调用方要记日志再确认丢弃。
    Args: fields。
    """
    if fields.get(_FIELD_VERSION) != ENVELOPE_VERSION:
        return None
    traceparent = fields.get(_FIELD_TRACEPARENT)
    raw = fields.get(_FIELD_RUN)
    if not raw or not traceparent:
        return None
    try:
        run_id = uuid.UUID(raw)
    except ValueError:
        return None
    return RunMessage(run_id=run_id, traceparent=traceparent)


async def publish_run(
    stream: StreamLike, *, target: StreamGroup, message: RunMessage
) -> str:
    """把一条运行任务投进流，返回条目 id。

    ⚠ 必须在事务**提交之后**投递（走 `lib.db.after_commit`，不是 FastAPI 的
    BackgroundTasks——后者在发响应时就地 await，排在会话提交**之前**）：提交前
    投出去，消费者可能先于提交读到运行行还不存在。
    ⚠ 消息的 traceparent 由 `RunMessage.to_fields` 带上，漏了它链路在这一跳
    齐断——队列不会自动传播 trace，而 `decode` 收不到它就整条拒掉。
    Args: stream, target, message。
    """
    return await stream.publish(target.stream, message.to_fields())
