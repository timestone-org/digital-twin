"""本副本持有的连接与它们的本地订阅。

⚠ 这是**进程内**状态，不是权威数据：连接是进程内对象，跨副本不可共享
（CONTEXT.md §4）。库里那张订阅表是给对账与诊断用的，扇出走这里。
两者不一致时以本表为准——它才知道哪条 socket 还活着。
"""

import asyncio
import uuid
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass, field
from datetime import datetime

from lib.logging import get_logger

_logger = get_logger("realtime.connections")

# 往这条连接发一条消息。⚠ 只声明成一个可等待的函数，不把 WebSocket 类型
# 带进来——这一层不该认识传输，测试也才能拿一个 list.append 顶上。
type SendFn = Callable[[dict[str, object]], Awaitable[None]]


@dataclass
class Connection:
    """一条已完成鉴权的客户端连接。"""

    id: uuid.UUID
    user_id: uuid.UUID
    # 该连接当前持有的权限码。⚠ 它会随 TTL 复核而变，不是握手时定死的
    codes: frozenset[str]
    # token 的到期时刻，逾期未 reauth 即关连接（close 4001）
    expires_at: datetime
    # 上一次复核权限的时刻
    checked_at: datetime
    send: SendFn
    topics: set[str] = field(default_factory=set[str])


class ConnectionRegistry:
    """本副本的连接表，以及「主题 → 连接」的反向索引。

    ⚠ 反向索引不能省：扇出时按主题找连接，遍历全部连接再逐个看订阅了什么，
    在几万条连接上是每条消息一次全表扫描。
    """

    def __init__(self) -> None:
        self._by_id: dict[uuid.UUID, Connection] = {}
        self._by_topic: dict[str, set[uuid.UUID]] = {}
        # ⚠ 单锁保护两张表：它们必须一起改，否则反向索引会指向已经关掉的连接
        self._lock = asyncio.Lock()

    async def add(self, connection: Connection) -> None:
        """登记一条新连接。

        Args: connection。
        """
        async with self._lock:
            self._by_id[connection.id] = connection

    async def remove(self, connection_id: uuid.UUID) -> None:
        """摘掉一条连接及它在反向索引里的全部占位。

        ⚠ 必须把空集合一并删掉：只 discard 不删键的话，`_by_topic` 会随着
        主题的生灭无限长大——大屏一开几天，那是纯泄漏。

        Args: connection_id。
        """
        async with self._lock:
            connection = self._by_id.pop(connection_id, None)
            if connection is None:
                return
            for topic in connection.topics:
                holders = self._by_topic.get(topic)
                if holders is None:
                    continue
                holders.discard(connection_id)
                if not holders:
                    del self._by_topic[topic]

    async def bind(self, connection_id: uuid.UUID, topic: str) -> None:
        """把连接挂到主题上。重复挂是幂等的。

        Args: connection_id, topic。
        """
        async with self._lock:
            connection = self._by_id.get(connection_id)
            if connection is None:
                return
            connection.topics.add(topic)
            self._by_topic.setdefault(topic, set()).add(connection_id)

    async def unbind(self, connection_id: uuid.UUID, topic: str) -> None:
        """从主题上摘掉连接。

        Args: connection_id, topic。
        """
        async with self._lock:
            connection = self._by_id.get(connection_id)
            if connection is not None:
                connection.topics.discard(topic)
            holders = self._by_topic.get(topic)
            if holders is None:
                return
            holders.discard(connection_id)
            if not holders:
                del self._by_topic[topic]

    async def subscribers(self, topic: str) -> tuple[Connection, ...]:
        """某个主题在本副本上的订阅连接快照。

        ⚠ 返回的是**快照**：扇出时要在锁外发送（发送可能阻塞在慢客户端上，
        锁内做长 IO 会把整个副本的订阅操作一起卡住）。

        Args: topic。
        """
        async with self._lock:
            holders = self._by_topic.get(topic, set())
            return tuple(
                self._by_id[item] for item in holders if item in self._by_id
            )

    async def get(self, connection_id: uuid.UUID) -> Connection | None:
        """取一条连接。

        Args: connection_id。
        """
        async with self._lock:
            return self._by_id.get(connection_id)

    async def all_connections(self) -> tuple[Connection, ...]:
        """本副本上的全部连接快照，供 TTL 复核逐条走一遍。"""
        async with self._lock:
            return tuple(self._by_id.values())

    async def refresh_codes(
        self,
        connection_id: uuid.UUID,
        *,
        codes: frozenset[str],
        checked_at: datetime,
    ) -> None:
        """复核后写回权限码与复核时刻。

        Args: connection_id, codes, checked_at。
        """
        async with self._lock:
            connection = self._by_id.get(connection_id)
            if connection is None:
                return
            connection.codes = codes
            connection.checked_at = checked_at

    def topics(self) -> Iterable[str]:
        """本副本当前有人订的全部主题。扇出订阅要按它决定听哪些频道。"""
        return tuple(self._by_topic)

    async def close_all(self) -> None:
        """关停时清空。连接本身由 WS 层各自关闭，这里只丢索引。"""
        async with self._lock:
            count = len(self._by_id)
            self._by_id.clear()
            self._by_topic.clear()
        _logger.info(
            "connection_registry_cleared", "连接索引已清空", connections=count
        )
