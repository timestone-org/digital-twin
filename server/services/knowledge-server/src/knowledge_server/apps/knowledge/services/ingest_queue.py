"""摄取任务的队列信封：编码、解码与投递。

⚠ 消息只带 `document_id`，不带「该走到哪一步」：以库里那一行的 `status` 为准。
带步骤的话，「从头解析」与「只补嵌入」就成了两种消息，而消费者要照顾两种分支——
而状态本来就写在库里，读一次就有。

⚠ 信封里必须带 `traceparent`（observability §4.2）：队列是异步的，
不带它链路在这一跳齐断，而每一段单看都是完整的。
"""

import uuid
from collections.abc import Mapping
from dataclasses import dataclass

from lib.logging import current_traceparent, get_logger
from lib.stream import StreamGroup, StreamLike

_logger = get_logger("knowledge.ingest")

# 信封版本。字段改形状时 +1，消费端据此拒掉读不懂的消息而不是猜
ENVELOPE_VERSION = "1"

_FIELD_VERSION = "envelope_version"
_FIELD_DOCUMENT = "document_id"
_FIELD_BASE = "base_id"
_FIELD_TRACEPARENT = "traceparent"


@dataclass(frozen=True)
class IngestMessage:
    """一次摄取任务。"""

    document_id: uuid.UUID
    base_id: uuid.UUID
    traceparent: str

    def to_fields(self) -> dict[str, str]:
        """摊成扁平的字符串字段，便于用 redis-cli 直接看。"""
        return {
            _FIELD_VERSION: ENVELOPE_VERSION,
            _FIELD_DOCUMENT: str(self.document_id),
            _FIELD_BASE: str(self.base_id),
            _FIELD_TRACEPARENT: self.traceparent,
        }


def new_message(document_id: uuid.UUID, base_id: uuid.UUID) -> IngestMessage:
    """当前链路上的一条摄取任务。

    Args: document_id, base_id。
    """
    return IngestMessage(
        document_id=document_id,
        base_id=base_id,
        traceparent=current_traceparent(),
    )


def _parsed(raw: str | None) -> uuid.UUID | None:
    if not raw:
        return None
    try:
        return uuid.UUID(raw)
    except ValueError:
        return None


def decode(fields: Mapping[str, str]) -> IngestMessage | None:
    """把流里的字段还原成任务；读不懂就给 `None`。

    ⚠ 读不懂的消息不能当成「跑完了」：调用方要记日志再确认丢弃，
    否则一条坏消息会被无限认领重投。

    Args: fields。
    """
    if fields.get(_FIELD_VERSION) != ENVELOPE_VERSION:
        return None
    document_id = _parsed(fields.get(_FIELD_DOCUMENT))
    base_id = _parsed(fields.get(_FIELD_BASE))
    traceparent = fields.get(_FIELD_TRACEPARENT)
    if document_id is None or base_id is None or not traceparent:
        return None
    return IngestMessage(
        document_id=document_id, base_id=base_id, traceparent=traceparent
    )


async def dispatch_ingest(
    stream: StreamLike, target: StreamGroup, message: IngestMessage
) -> None:
    """把摄取任务投进队列。**必须在事务提交之后跑**。

    ⚠ 信封里的 traceparent 由 `IngestMessage.to_fields` 带上（队列不会自动
    传播它）。漏了的话链路在这一跳齐断，而每一段单看都是完整的。

    ⚠ 提交前投出去的话，worker 可能先于提交读到——那时文档行还不存在，
    它只能把这条当成「文档已删」丢掉，而原件其实好好的。

    ⚠ 投递失败**不回滚**已经落库的文档行，也不重试：文档本身已经登记好了
    （原件在桶里、行在库里 `pending`），失败只意味着它停在待处理，
    由界面上的「重新解析」兜底。这条链路上没有任何一层在重试，
    故失败必须看得见——记 error 级日志。

    Args: stream, target, message。
    """
    try:
        await stream.publish(target.stream, message.to_fields())
    except Exception as error:
        _logger.error(
            "knowledge_ingest_dispatch_failed",
            "摄取任务未能入队，这份文档停在待处理",
            document_id=str(message.document_id),
            error=error,
        )
