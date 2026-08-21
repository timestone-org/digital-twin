"""模型压缩任务的队列信封：编码、解码与投递。

⚠ 消息只带 `asset_id` 不带档位清单：以库里那几行 `pending` 为准。带清单的话，
「重压其中一档」与「重压全部」就成了两种消息，而消费者要照顾两种分支——
而档位本来就写在库里，读一次就有。
⚠ 信封里必须带 `traceparent`（observability.md §4.2）：队列是异步的，
不带它链路在这一跳齐断。
"""

import uuid
from collections.abc import Mapping
from dataclasses import dataclass

from lib.logging import current_traceparent, get_logger
from platform_server.stream import StreamGroup, StreamLike

_logger = get_logger("platform.assets.compress")

# 信封版本。字段改形状时 +1，消费端据此拒掉读不懂的消息而不是猜
ENVELOPE_VERSION = "1"

_FIELD_VERSION = "envelope_version"
_FIELD_ASSET = "asset_id"
_FIELD_TRACEPARENT = "traceparent"


@dataclass(frozen=True)
class CompressMessage:
    """一次模型压缩任务。"""

    asset_id: uuid.UUID
    traceparent: str

    def to_fields(self) -> dict[str, str]:
        """摊成扁平的字符串字段，便于用 redis-cli 直接看。"""
        return {
            _FIELD_VERSION: ENVELOPE_VERSION,
            _FIELD_ASSET: str(self.asset_id),
            _FIELD_TRACEPARENT: self.traceparent,
        }


def new_message(asset_id: uuid.UUID) -> CompressMessage:
    """当前链路上的一条压缩任务。

    Args: asset_id。
    """
    return CompressMessage(asset_id=asset_id, traceparent=current_traceparent())


def decode(fields: Mapping[str, str]) -> CompressMessage | None:
    """把流里的字段还原成任务；读不懂就给 None。

    ⚠ 读不懂的消息不能当成「跑完了」：调用方要记日志再确认丢弃。
    Args: fields。
    """
    if fields.get(_FIELD_VERSION) != ENVELOPE_VERSION:
        return None
    traceparent = fields.get(_FIELD_TRACEPARENT)
    raw = fields.get(_FIELD_ASSET)
    if not raw or not traceparent:
        return None
    try:
        asset_id = uuid.UUID(raw)
    except ValueError:
        return None
    return CompressMessage(asset_id=asset_id, traceparent=traceparent)


async def publish_compression(
    stream: StreamLike, *, target: StreamGroup, message: CompressMessage
) -> str:
    """把一条压缩任务投进流，返回条目 id。

    ⚠ 消息的 traceparent 由 `CompressMessage.to_fields` 带上，漏了它链路在
    这一跳齐断。
    ⚠ 必须在事务**提交之后**投递：提交前投出去，worker 可能先于提交读到——
    那时素材行还不存在，它只能把这条当成「素材已删」丢掉，而字节其实好好的。
    ⚠ 投递失败**不回滚**已经落库的素材：那时库里留着几行 `pending`，由界面上
    的「重压」兜底，比丢掉一个已经传好的 200MB 素材好得多。
    Args: stream, target, message。
    """
    return await stream.publish(target.stream, message.to_fields())


async def dispatch_compression(
    stream: StreamLike, *, target: StreamGroup, message: CompressMessage
) -> None:
    """把压缩任务投进队列。**必须在事务提交之后跑**。

    ⚠ 投递失败不回滚素材，也不重试：素材本身已经可用（原件在桶里、行在库里），
    失败只意味着那几档还停在 `pending`，由界面上的「重压」兜底。这条链路上没有
    任何一层在重试，故失败必须看得见——记 error 级日志。
    Args: stream, target, message。
    """
    try:
        await publish_compression(stream, target=target, message=message)
    except Exception as error:
        _logger.error(
            "asset_compress_dispatch_failed",
            "压缩任务未能入队，该素材的压缩档停在待压缩",
            asset_id=str(message.asset_id),
            error=error,
        )
