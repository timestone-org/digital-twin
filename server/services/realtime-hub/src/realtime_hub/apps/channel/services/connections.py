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
# 往这条连接发一帧**已经编码好的** JSON。⚠ 扇出走它而不是走 `SendFn`：一份
# 信封最多 500 个条目，发给一面墙上的二十块屏，`send_json` 就是同一段
# 序列化重来二十遍。控制帧仍走 `SendFn`——它们小且稀疏，不值得多一层。
type SendFrameFn = Callable[[str], Awaitable[None]]
# 按给定的关闭码断掉这条连接。复核任务要摘掉授权已被撤回的匿名连接，而它
# 手上只有连接对象。⚠ 同样不认识 WebSocket。
type CloseFn = Callable[[int], Awaitable[None]]


@dataclass(frozen=True)
class GrantedTopic:
    """匿名连接握手时拿到的那一条授权。

    ⚠ `alias` 是这条连接对外唯一说得出口的主题名，由票据本身派生；真主题
    `topic` 一个字都不出门。少了这层改名，匿名访客就能从帧里读出主题标识，
    而那正是 ADR-0014「公开面不回任何能定位它在库里位置的信息」挡的东西。
    """

    ticket_hash: str
    alias: str
    topic: str


@dataclass(frozen=True)
class AnonymousQuota:
    """匿名连接的名额。⚠ 按副本计，不是全集群——它防的是一枚泄露的票据把
    单个副本的连接池吃满，而副本之间本来就靠负载均衡分摊。"""

    max_total: int
    max_per_ticket: int


@dataclass
class Connection:
    """一条已完成鉴权的客户端连接。"""

    id: uuid.UUID
    # ⚠ 匿名连接没有用户：公开链接的持有者不是任何一个人（ADR-0021）。
    # 用哨兵 UUID 顶替的话，订阅表里会出现一个不存在的「用户」
    user_id: uuid.UUID | None
    # 该连接当前持有的权限码。⚠ 它会随 TTL 复核而变，不是握手时定死的
    codes: frozenset[str]
    # token 的到期时刻，逾期未 reauth 即关连接（close 4001）
    expires_at: datetime
    # 上一次复核权限的时刻
    checked_at: datetime
    send: SendFn
    send_frame: SendFrameFn
    # 匿名连接的授权；登录态连接为 None
    grant: GrantedTopic | None = None
    topics: set[str] = field(default_factory=set[str])
    # 真主题 → 这条连接对外看到的名字。只有匿名连接有条目
    aliases: dict[str, str] = field(default_factory=dict[str, str])
    close: CloseFn | None = None

    def outgoing_topic(self, topic: str) -> str:
        """一帧发给这条连接时，信封上该写哪个主题名。

        Args: topic。
        """
        return self.aliases.get(topic, topic)


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

    async def add(
        self, connection: Connection, *, quota: AnonymousQuota | None = None
    ) -> bool:
        """登记一条新连接；名额不够时不登记并返回 False。

        ⚠ 名额在锁内判：判完再加的话，同一枚票据并发握手会一起看到「还有
        名额」，于是名额形同虚设——而这正是一枚泄露的票据会做的事。

        Args: connection, quota。
        """
        async with self._lock:
            if quota is not None and not self._has_room(
                connection.grant, quota
            ):
                return False
            self._by_id[connection.id] = connection
        return True

    async def has_room(
        self, grant: GrantedTopic | None, quota: AnonymousQuota
    ) -> bool:
        """这枚票据还开得起一条连接吗。握手在 accept **之前**先问它。

        ⚠ 问完再登记之间有一个窄窗口，登记那一步会在锁内再判一次。两处都要：
        只在登记那一步判的话，拒绝就发生在 accept 之后——而 accept 之后再关，
        客户端的退避已经归零，表现是每秒一次的空转重连。

        Args: grant, quota。
        """
        async with self._lock:
            return self._has_room(grant, quota)

    def _has_room(
        self, grant: GrantedTopic | None, quota: AnonymousQuota
    ) -> bool:
        """匿名名额还够不够。⚠ 只在锁内调。

        Args: grant, quota。
        """
        if grant is None:
            return True
        anonymous = [item for item in self._by_id.values() if item.grant]
        if len(anonymous) >= quota.max_total:
            return False
        same = sum(
            1
            for item in anonymous
            if item.grant is not None
            and item.grant.ticket_hash == grant.ticket_hash
        )
        return same < quota.max_per_ticket

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

    async def bind(
        self, connection_id: uuid.UUID, topic: str, *, alias: str | None = None
    ) -> None:
        """把连接挂到主题上。重复挂是幂等的。

        Args: connection_id, topic, alias（匿名连接对外看到的名字）。
        """
        async with self._lock:
            connection = self._by_id.get(connection_id)
            if connection is None:
                return
            connection.topics.add(topic)
            if alias is not None:
                connection.aliases[topic] = alias
            self._by_topic.setdefault(topic, set()).add(connection_id)

    async def unbind(self, connection_id: uuid.UUID, topic: str) -> None:
        """从主题上摘掉连接。

        Args: connection_id, topic。
        """
        async with self._lock:
            connection = self._by_id.get(connection_id)
            if connection is not None:
                connection.topics.discard(topic)
                connection.aliases.pop(topic, None)
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

    async def anonymous(self) -> tuple[Connection, ...]:
        """本副本上的全部匿名连接快照。授权复核只看这些。"""
        async with self._lock:
            return tuple(
                item for item in self._by_id.values() if item.grant is not None
            )

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
