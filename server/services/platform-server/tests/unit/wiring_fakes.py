"""非 HTTP 角色（worker / publisher）共用的装配假件。

⚠ 关停次序靠一本共享账本记：两个角色的收摊顺序都是「先停活、后关资源」，
而顺序写错既不报错也不失败，只会让在途工作拿着一个已经关掉的连接池。
"""

from dataclasses import dataclass, field
from typing import cast

from pydantic import SecretStr

from lib.cache import Cache, PubSub
from lib.db import Database, ReadOnlySqlSource
from lib.testing import FakeObjectStore, InMemoryCache
from platform_server.apps.collect.services import CommandBus, PlanNotifier
from platform_server.apps.collect.services.command_transport import (
    RedisCommandTransport,
)
from platform_server.apps.dashboard.services import (
    IdempotencyStore,
    StaticPointCatalog,
    SubscriptionViewers,
    load_module_catalog,
)
from platform_server.container import Container
from platform_server.lease import Lease
from platform_server.realtime import RealtimeClient
from platform_server.settings import ROLE_WORKER, Settings
from platform_server.stream import RedisStream
from unit.collect_fakes import (
    FakeChannelPublisher,
    FakeCommandTransport,
    FakeHistorySource,
)
from unit.opcua_fakes import FakeNodeWriter
from unit.publish_fakes import FakeSnapshotSource, FakeViewerSource

PLACEHOLDER = "wiring-test"
PLAN_CHANNEL = "collect:plan:changed"


@dataclass
class FakeDependency:
    """只回答通不通，并把自己被关的次序记进共享的账本。"""

    name: str
    ledger: list[str]
    is_reachable: bool = True

    async def ping(self) -> bool:
        return self.is_reachable

    async def dispose(self) -> None:
        self.ledger.append(self.name)

    async def close(self) -> None:
        self.ledger.append(self.name)


@dataclass
class LedgerSnapshotSource(FakeSnapshotSource):
    """快照面，关掉时记一笔账。"""

    name: str = "snapshots"
    ledger: list[str] = field(default_factory=list[str])

    async def close(self) -> None:
        self.ledger.append(self.name)


@dataclass
class LedgerLease:
    """租约，让位与关闭都记账。语义照 `RedisLease`。"""

    ledger: list[str]
    is_grantable: bool = True
    is_renewable: bool = True

    async def acquire(self) -> bool:
        return self.is_grantable

    async def renew(self) -> bool:
        return self.is_renewable

    async def release(self) -> None:
        self.ledger.append("lease_released")

    async def close(self) -> None:
        self.ledger.append("lease")


def build_settings(
    *, role: str = ROLE_WORKER, instance: str = "worker-1"
) -> Settings:
    """一份能构造出来的非 HTTP 角色配置，不连任何依赖。

    Args: role, instance。
    """
    return Settings(
        app_role=role,
        app_instance=instance,
        postgres_host=PLACEHOLDER,
        postgres_user=PLACEHOLDER,
        postgres_password=SecretStr(PLACEHOLDER),
        postgres_db=PLACEHOLDER,
        sqlserver_host=PLACEHOLDER,
        sqlserver_user=PLACEHOLDER,
        sqlserver_password=SecretStr(PLACEHOLDER),
        sqlserver_database=PLACEHOLDER,
        redis_host=PLACEHOLDER,
        edge_signing_secret=SecretStr("x" * 32),
        edge_service_key=SecretStr("y" * 32),
        objectstore_endpoint="http://placeholder:9000",
        objectstore_bucket=PLACEHOLDER,
        objectstore_access_key=SecretStr(PLACEHOLDER),
        objectstore_secret_key=SecretStr("z" * 12),
    )


def build_container(ledger: list[str], *, settings: Settings) -> Container:
    """一个装着假依赖的组合根。

    Args: ledger, settings。
    """
    # cast 的理由：这几件只需要满足 ping/dispose/close，容器本身不做类型校验
    return Container(
        settings=settings,
        database=cast(Database, FakeDependency("database", ledger)),
        ac_source=cast(ReadOnlySqlSource, FakeDependency("ac_source", ledger)),
        stream=cast(RedisStream, FakeDependency("stream", ledger)),
        cache=cast(Cache, FakeDependency("cache", ledger)),
        idempotency=IdempotencyStore(cache=InMemoryCache()),
        module_catalog=load_module_catalog(),
        points=StaticPointCatalog(),
        history=FakeHistorySource(),
        history_database=cast(
            Database, FakeDependency("history_database", ledger)
        ),
        command_bus=CommandBus(
            transport=FakeCommandTransport(),
            browse_timeout_s=10.0,
            command_timeout_s=5.0,
        ),
        command_transport=cast(
            RedisCommandTransport, FakeDependency("command_bus", ledger)
        ),
        plan_notifier=PlanNotifier(
            publisher=FakeChannelPublisher(), channel=PLAN_CHANNEL
        ),
        pubsub=cast(PubSub, FakeDependency("pubsub", ledger)),
        snapshots=LedgerSnapshotSource(ledger=ledger),
        viewers=SubscriptionViewers(source=FakeViewerSource()),
        viewer_database=cast(
            Database, FakeDependency("viewer_database", ledger)
        ),
        realtime=RealtimeClient(
            base_url="http://realtime-test",
            service_key=PLACEHOLDER,
            timeout_s=1.0,
        ),
        lease=cast(Lease, LedgerLease(ledger=ledger)),
        ac_publish_lease=cast(Lease, LedgerLease(ledger=ledger)),
        ac_daily_lease=cast(Lease, LedgerLease(ledger=ledger)),
        nodes=FakeNodeWriter(),
        object_store=FakeObjectStore(),
    )
