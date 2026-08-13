"""推送：分配 seq、落库、跨副本扇出。

⚠ 顺序是「先在事务里拿 seq 并提交，再在事务外发 Redis」。倒过来或合在一起
都不行：`database-standard.md` 禁止事务内做外部 IO 与投队列——一次 Redis
抖动会把数据库连接一起占住，而连接池是全服务共用的。

另三条口径：

1. **条目数超限拒绝，不自动分片。** 分片是推送方的事；hub 一旦知道「哪些
   载荷可以拆」，就又长出业务知识了（ADR-0007）。
2. **提交之后 Redis 发失败时 seq 已经消耗**，客户端会看到一个缺口。这是
   刻意的：seq 的用途就是让客户端发现丢帧并自行补齐，比让两条消息共用一个
   seq 好得多——重号会被客户端当成重复直接丢弃。
3. **`traceparent` 由推送方经 HTTP 头传进来，原样放进信封。** lib 的 pub/sub
   在没有显式值时会按当前上下文补一个，但那个上下文未必是推送方的——跨服务
   的那一段只能靠头传。
"""

from datetime import datetime
from typing import Any

from lib.cache import PubSub
from lib.cache.pubsub import TRACEPARENT_KEY
from lib.db import Database
from lib.logging import get_logger
from lib.logging.context import current_log_context
from lib.utils.timeutils import utcnow
from realtime_hub.apps.channel.crud import TopicCrud
from realtime_hub.apps.channel.errors import PayloadTooLarge, TopicNotDeclared

_logger = get_logger("realtime.publisher")

# 服务端 → 客户端的消息类型，api-contract §10 的字符串枚举
MESSAGE_TYPE_DATA = "data"


class PublishService:
    """把推送方给的一条载荷变成带 seq 的信封，扇给所有副本。"""

    def __init__(
        self,
        *,
        database: Database,
        pubsub: PubSub,
        topics: TopicCrud,
        channel: str,
        max_items: int,
    ) -> None:
        self._database = database
        self._pubsub = pubsub
        self._topics = topics
        self._channel = channel
        self._max_items = max_items

    async def publish(
        self,
        *,
        topic: str,
        items: list[dict[str, Any]],
        traceparent: str | None = None,
    ) -> int:
        """推一条消息，返回本次分配到的 seq。三条口径见模块头。

        Args: topic, items, traceparent（推送方经 HTTP 头传进来的）。
        """
        if len(items) > self._max_items:
            raise PayloadTooLarge(
                f"单条推送最多 {self._max_items} 个条目，请分片后重试"
            )
        now = utcnow()
        async with self._database.session() as session:
            seq = await self._topics.bump_seq(session, topic, now=now)
        if seq is None:
            raise TopicNotDeclared(f"主题 {topic} 未登记，无法推送")

        envelope = _envelope(
            topic=topic,
            items=items,
            seq=seq,
            now=now,
            traceparent=traceparent,
        )
        # ⚠ 事务已经提交，这里在事务之外
        delivered = await self._pubsub.publish(self._channel, envelope)
        _logger.info(
            "message_published",
            "消息已扇出",
            topic=topic,
            seq=seq,
            items=len(items),
            # 收到它的副本数。0 表示当前没有副本在听这个主题——不是错误，
            # 可能确实没人订
            replicas=delivered,
        )
        return seq


def _envelope(
    *,
    topic: str,
    items: list[dict[str, Any]],
    seq: int,
    now: datetime,
    traceparent: str | None,
) -> dict[str, Any]:
    """按 api-contract §10 拼一条服务端 → 客户端的信封。

    Args: topic, items, seq, now, traceparent。
    """
    envelope: dict[str, Any] = {
        "type": MESSAGE_TYPE_DATA,
        "topic": topic,
        "ts": now.isoformat().replace("+00:00", "Z"),
        "seq": seq,
        "payload": {"items": items},
        # §10 要求信封带 trace_id，客户端据它把一条数据与自己那次操作对上
        "trace_id": current_log_context().trace_id,
    }
    if traceparent is not None:
        envelope[TRACEPARENT_KEY] = traceparent
    return envelope
