"""装配契约：外库进关停序列与启动自检，但**绝不进就绪判定**。

⚠ 把外库塞进 readiness 会让厂商库抖一下就摘掉整个副本的流量，连台账页与空间
配置页一起挂掉——而那两页根本不读外库。理由见 docs/adr/0006。
"""

from dataclasses import dataclass, field
from typing import cast

from pydantic import SecretStr

from lib.cache import Cache, PubSub
from lib.cache.protocol import CacheLike
from lib.db import Database, ReadOnlySqlSource
from lib.idempotency import IdempotencyStore
from lib.stream import RedisStream
from lib.testing import FakeObjectStore, InMemoryCache
from platform_server.app import _hooks, _probes, _selfcheck
from platform_server.apps.collect.services import (
    CommandBus,
    CredentialCipher,
    PlanNotifier,
    SubscriptionWatchers,
)
from platform_server.apps.collect.services.command_transport import (
    RedisCommandTransport,
)
from platform_server.apps.dashboard.services import (
    StaticPointCatalog,
    SubscriptionViewers,
    load_module_catalog,
)
from platform_server.apps.hvac.deps import get_ac_source_reader
from platform_server.apps.hvac.services.ac_source_reader import AcSourceReader
from platform_server.apps.modeling.services.artifact_io import ArtifactCache
from platform_server.container import (
    IDEMPOTENCY_NAMESPACE,
    Container,
)
from platform_server.lease import Lease
from platform_server.opcua import OpcuaClient
from platform_server.realtime import RealtimeClient
from platform_server.settings import Settings
from unit.collect_fakes import (
    FakeChannelPublisher,
    FakeCommandTransport,
    FakeHistorySource,
)
from unit.dataset_fakes import dataset_parts
from unit.opcua_fakes import FakeNodeWriter
from unit.publish_fakes import FakeSnapshotSource, FakeViewerSource

PLACEHOLDER = "wiring-test"


@dataclass
class FakeDependency:
    """只回答「通不通」并记下自己有没有被关掉。"""

    is_reachable: bool = True
    closed: list[str] = field(default_factory=list)

    async def ping(self) -> bool:
        return self.is_reachable

    async def dispose(self) -> None:
        self.closed.append("once")

    async def close(self) -> None:
        self.closed.append("once")


def build_settings() -> Settings:
    """一份能构造出来的配置，不连任何依赖。"""
    return Settings(
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
        collect_credential_secret=SecretStr("c" * 32),
        objectstore_endpoint="http://placeholder:9000",
        objectstore_bucket=PLACEHOLDER,
        objectstore_access_key=SecretStr(PLACEHOLDER),
        objectstore_secret_key=SecretStr("z" * 12),
    )


def _command_bus() -> CommandBus:
    """一条打假件的命令总线。三档预算在用例里固定住。"""
    return CommandBus(
        transport=FakeCommandTransport(),
        browse_timeout_s=10.0,
        command_timeout_s=5.0,
        subtree_timeout_s=15.0,
    )


def _realtime() -> RealtimeClient:
    """一个指向假地址的实时客户端。用例不许真发请求。"""
    return RealtimeClient(
        base_url="http://realtime-test",
        service_key=PLACEHOLDER,
        timeout_s=1.0,
    )


def _idempotency(cache: CacheLike) -> IdempotencyStore:
    """幂等结果的缓存面，命名空间与生产装配一致。

    Args: cache。
    """
    return IdempotencyStore(cache=cache, namespace=IDEMPOTENCY_NAMESPACE)


def build_container(
    *, is_database_up: bool = True, is_source_up: bool = True
) -> tuple[Container, FakeDependency, FakeDependency]:
    """一个装着假依赖的组合根。

    Args: is_database_up, is_source_up。
    """
    database = FakeDependency(is_reachable=is_database_up)
    source = FakeDependency(is_reachable=is_source_up)
    cache = InMemoryCache()
    # cast 的理由：这几件只需要满足 ping/dispose/close，容器本身不做类型校验
    container = Container(
        settings=build_settings(),
        database=cast(Database, database),
        ac_source=cast(ReadOnlySqlSource, source),
        stream=cast(RedisStream, FakeDependency()),
        cache=cast(Cache, FakeDependency()),
        idempotency=_idempotency(cache),
        module_catalog=load_module_catalog(),
        points=StaticPointCatalog(),
        history=FakeHistorySource(),
        history_database=cast(Database, FakeDependency()),
        command_bus=_command_bus(),
        command_transport=cast(RedisCommandTransport, FakeDependency()),
        plan_notifier=PlanNotifier(
            publisher=FakeChannelPublisher(), channel="collect:plan:changed"
        ),
        pubsub=cast(PubSub, FakeDependency()),
        snapshots=FakeSnapshotSource(),
        viewers=SubscriptionViewers(source=FakeViewerSource()),
        collect_watchers=SubscriptionWatchers(source=FakeViewerSource()),
        viewer_database=cast(Database, FakeDependency()),
        realtime=_realtime(),
        lease=cast(Lease, FakeDependency()),
        ac_publish_lease=cast(Lease, FakeDependency()),
        ac_daily_lease=cast(Lease, FakeDependency()),
        nodes=cast(OpcuaClient, FakeNodeWriter()),
        object_store=FakeObjectStore(),
        modeling_artifacts=ArtifactCache(),
        credential_cipher=CredentialCipher("c" * 32),
        dataset=dataset_parts(
            cast(Database, database),
            build_settings(),
            cast(Lease, FakeDependency()),
        ),
    )
    return container, database, source


def test_readiness_never_waits_on_the_external_source() -> None:
    container, _database, _source = build_container()
    assert [probe.name for probe in _probes(container)] == ["postgres"]


def test_the_external_source_is_closed_before_the_connection_pool() -> None:
    # 连接池最后关：在途请求还要用它。
    # ⚠ 在跑的历史回填排在**最前**：它收摊时还要写一次终态、放一次锁（要
    # Redis），最后一批的提交还要连接池——排在它们后面就是关完了才想起来收摊
    container, _database, _source = build_container()
    closing = [
        hook.name
        for hook in sorted(
            _hooks(container), key=lambda item: item.shutdown_order
        )
        if hook.shutdown is not None
    ]
    assert closing == [
        "dataset_backfill",
        "stream",
        "cache",
        "command_bus",
        "pubsub",
        "snapshots",
        "lease",
        "realtime",
        "opcua",
        "ac_source",
        "history_database",
        "viewer_database",
        "database",
    ]


async def assert_selfcheck_survives(
    *, is_database_up: bool, is_source_up: bool
) -> None:
    """启动自检的契约就是「只记录、不抛」。

    Args: is_database_up, is_source_up。
    """
    container, _database, _source = build_container(
        is_database_up=is_database_up, is_source_up=is_source_up
    )
    await _selfcheck(container)


async def test_an_unreachable_source_does_not_block_startup() -> None:
    # 外库挂了不该让进程起不来，它只让空调数据面返回 503
    await assert_selfcheck_survives(is_database_up=True, is_source_up=False)


async def test_an_unreachable_database_does_not_block_startup_either() -> None:
    # 数据库不可达由就绪探针拦，不由启动流程拦
    await assert_selfcheck_survives(is_database_up=False, is_source_up=True)


async def test_a_healthy_startup_checks_both_dependencies() -> None:
    await assert_selfcheck_survives(is_database_up=True, is_source_up=True)


def test_the_reader_dependency_takes_its_timezone_from_config() -> None:
    container, _database, _source = build_container()
    assert isinstance(get_ac_source_reader(container), AcSourceReader)
