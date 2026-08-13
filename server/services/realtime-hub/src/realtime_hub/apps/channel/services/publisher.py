"""推送：分配 seq、落库、跨副本扇出。

⚠ 顺序是「先在事务里拿 seq 并提交，再在事务外发 Redis」。倒过来或合在一起
都不行：`database-standard.md` 禁止事务内做外部 IO 与投队列——一次 Redis
抖动会把数据库连接一起占住，而连接池是全服务共用的。
"""

from collections.abc import Callable
from typing import Any

from lib.cache import PubSub
from lib.db import Database
from lib.logging import get_logger
from lib.utils.timeutils import utcnow
from realtime_hub.apps.channel.crud import TopicCrud
from realtime_hub.apps.channel.errors import PayloadTooLarge, TopicNotDeclared

_logger = get_logger("realtime.publisher")

# 服务端 → 客户端的消息类型，api-contract §10 的字符串枚举
MESSAGE_TYPE_DATA = "data"

# 主题 → Redis 频道名。注进来而不是在这里拼：频道命名是配置的事
type ChannelFn = Callable[[str], str]


class PublishService:
    """把推送方给的一条载荷变成带 seq 的信封，扇给所有副本。"""

    def __init__(
        self,
        *,
        database: Database,
        pubsub: PubSub,
        topics: TopicCrud,
        channel_of: ChannelFn,
        max_items: int,
    ) -> None:
        self._database = database
        self._pubsub = pubsub
        self._topics = topics
        self._channel_of = channel_of
        self._max_items = max_items

    async def publish(self, *, topic: str, items: list[dict[str, Any]]) -> int:
        """推一条消息，返回本次分配到的 seq。

        ⚠ 条目数超限**拒绝**而不是自动分片：分片是推送方的事。hub 一旦知道
        「哪些载荷可以拆」，就又长出业务知识了（ADR-0007）。

        ⚠ 提交之后 Redis 发失败时 seq 已经消耗掉了，客户端会看到一个缺口。
        这是**刻意的**：seq 的用途就是让客户端发现丢帧并自行补齐，比让两条
        消息共用一个 seq 好得多——重号会被客户端当成重复直接丢弃。

        Args: topic, items。
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

        envelope: dict[str, Any] = {
            "type": MESSAGE_TYPE_DATA,
            "topic": topic,
            "ts": now.isoformat().replace("+00:00", "Z"),
            "seq": seq,
            "payload": {"items": items},
        }
        # ⚠ 事务已经提交，这里在事务之外
        delivered = await self._pubsub.publish(
            self._channel_of(topic), envelope
        )
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
