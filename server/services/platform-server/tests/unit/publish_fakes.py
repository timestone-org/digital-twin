"""发布面那四跳跨进程调用的进程内假件：快照、订阅表、hub、租约。

⚠ 每一件都按被替代者的 Protocol 写：假件与真实现的语义一旦漂移，测试全绿而
生产失效——租约那一件尤其（假件放行两次 acquire 就等于放行双主）。
"""

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from platform_server.apps.collect.services import PointReading
from platform_server.apps.dashboard.services.viewers import (
    ID_COLUMN,
    TOPIC_COLUMN,
)


@dataclass
class FakeSnapshotSource:
    """按名单回读数的快照面。名单外的点位**不出现在结果里**。"""

    readings: dict[str, PointReading] = field(
        default_factory=dict[str, PointReading]
    )
    failure: Exception | None = None
    asked: list[tuple[str, ...]] = field(default_factory=list[tuple[str, ...]])
    is_closed: bool = False

    async def read(self, node_keys: Sequence[str]) -> dict[str, PointReading]:
        self.asked.append(tuple(node_keys))
        if self.failure is not None:
            raise self.failure
        return {
            node_key: self.readings[node_key]
            for node_key in node_keys
            if node_key in self.readings
        }

    async def ping(self) -> bool:
        return self.failure is None

    async def close(self) -> None:
        self.is_closed = True


@dataclass
class FakeViewerSource:
    """订阅表的只读面。用例直接给行，不解析 SQL。"""

    rows: list[dict[str, object]] = field(
        default_factory=list[dict[str, object]]
    )
    failure: Exception | None = None
    queries: list[tuple[str, dict[str, object]]] = field(
        default_factory=list[tuple[str, dict[str, object]]]
    )

    async def fetch_all(
        self, sql: str, params: Mapping[str, object]
    ) -> list[dict[str, object]]:
        self.queries.append((sql, dict(params)))
        if self.failure is not None:
            raise self.failure
        return list(self.rows)


def subscription_row(
    topic: str, subscription_id: uuid.UUID
) -> dict[str, object]:
    """造一条订阅行，键名与只读查询选出的列一致。

    Args: topic, subscription_id（订阅行主键，退订重订会换新）。
    """
    return {TOPIC_COLUMN: topic, ID_COLUMN: subscription_id}


@dataclass
class FakeRealtime:
    """hub 的内部端点。记下每一次调用，并能整体判失败。"""

    known_topics: list[str] = field(default_factory=list[str])
    declared: list[tuple[str, str, str]] = field(
        default_factory=list[tuple[str, str, str]]
    )
    revoked: list[str] = field(default_factory=list[str])
    known_grants: list[str] = field(default_factory=list[str])
    granted: list[tuple[str, str, str]] = field(
        default_factory=list[tuple[str, str, str]]
    )
    revoked_grants: list[str] = field(default_factory=list[str])
    published: list[tuple[str, list[dict[str, Any]], str | None]] = field(
        default_factory=list[tuple[str, list[dict[str, Any]], str | None]]
    )
    is_reachable: bool = True

    async def declare(
        self, *, topic: str, required_code: str, publisher: str
    ) -> bool:
        self.declared.append((topic, required_code, publisher))
        if self.is_reachable:
            self.known_topics.append(topic)
        return self.is_reachable

    async def topics(self, publisher: str) -> list[str]:
        del publisher
        # ⚠ 不可达时回空列表，与真实现一致：那只会导致补登记，不会导致注销
        return list(self.known_topics) if self.is_reachable else []

    async def revoke(self, topic: str) -> bool:
        self.revoked.append(topic)
        if self.is_reachable and topic in self.known_topics:
            self.known_topics.remove(topic)
        return self.is_reachable

    async def declare_grant(
        self, *, ticket_hash: str, topic: str, publisher: str
    ) -> bool:
        self.granted.append((ticket_hash, topic, publisher))
        if self.is_reachable:
            self.known_grants.append(ticket_hash)
        return self.is_reachable

    async def grants(self, publisher: str) -> list[str]:
        del publisher
        # ⚠ 不可达时回空列表，与真实现一致：只会补登记，不会注销
        return list(self.known_grants) if self.is_reachable else []

    async def revoke_grant(self, ticket_hash: str) -> bool:
        self.revoked_grants.append(ticket_hash)
        if self.is_reachable and ticket_hash in self.known_grants:
            self.known_grants.remove(ticket_hash)
        return self.is_reachable

    async def publish(
        self,
        *,
        topic: str,
        items: list[dict[str, Any]],
        traceparent: str | None = None,
    ) -> bool:
        self.published.append((topic, list(items), traceparent))
        return self.is_reachable


@dataclass
class FakeLease:
    """租约。⚠ 语义照 `RedisLease`：已被别人持有时 `acquire` 必须为假。"""

    is_grantable: bool = True
    is_renewable: bool = True
    ledger: list[str] = field(default_factory=list[str])
    is_closed: bool = False

    async def acquire(self) -> bool:
        self.ledger.append("acquire")
        return self.is_grantable

    async def renew(self) -> bool:
        self.ledger.append("renew")
        return self.is_renewable

    async def release(self) -> None:
        self.ledger.append("release")

    async def close(self) -> None:
        self.is_closed = True
