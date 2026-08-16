"""组合根：把配置拧成各个协作对象。装配只在这里发生，模块顶层不做副作用。"""

from dataclasses import dataclass

from lib.cache import Cache, PubSub
from lib.db import Database, PoolProfile, ReadOnlySqlSource, SourceProfile
from lib.objectstore import ObjectStore, create_object_store
from platform_server.apps.collect.crud import HistorySource
from platform_server.apps.collect.services import (
    CommandBus,
    CredentialCipher,
    DatabasePointCatalog,
    PlanNotifier,
    ReadOnlyHistorySource,
    RedisCommandTransport,
    RedisSnapshotSource,
    SnapshotSource,
    SubscriptionWatchers,
)
from platform_server.apps.dashboard.services import (
    SUBSCRIPTION_SCHEMA,
    IdempotencyStore,
    ModuleCatalog,
    PointCatalog,
    ReadOnlyViewerSource,
    SubscriptionViewers,
    load_module_catalog,
)
from platform_server.lease import Lease, RedisLease
from platform_server.opcua import NodeWriter, OpcuaClient
from platform_server.realtime import RealtimeClient
from platform_server.settings import Settings
from platform_server.stream import RedisStream
from timeseries import HISTORY_SCHEMA

# 阻塞读之外留给服务端应答与网络的余量
STREAM_READ_MARGIN_S = 2.0

# 单活租约的键。⚠ 全系统只有一个大屏发布者，键名写死而不是配置项：让它可配
# 等于让两份配置各选出一个主，而两个主会对同一个主题各推各的
PUBLISHER_LEASE_KEY = "platform:publisher:leader"
# 预测下发与每日增量各自的单活租约键。理由同上：写死不可配
AC_PUBLISH_LEASE_KEY = "platform:ac-publish:leader"
AC_DAILY_LEASE_KEY = "platform:ac-startup-daily:leader"


@dataclass(frozen=True)
class Container:
    """一个进程内的全部长生命周期对象。"""

    settings: Settings
    database: Database
    ac_source: ReadOnlySqlSource
    stream: RedisStream
    cache: Cache
    idempotency: IdempotencyStore
    module_catalog: ModuleCatalog
    points: PointCatalog
    history: HistorySource
    history_database: Database
    command_bus: CommandBus
    command_transport: RedisCommandTransport
    plan_notifier: PlanNotifier
    pubsub: PubSub
    snapshots: SnapshotSource
    viewers: SubscriptionViewers
    # 采集配置页的活跃集合。⚠ 与 `viewers` 读的是同一张订阅表、同一个只读连接
    # 池，只是把主题解释成了另一种实体——两条链路各自解释自己的主题前缀
    collect_watchers: SubscriptionWatchers
    viewer_database: Database
    realtime: RealtimeClient
    lease: Lease
    # ⚠ 三把租约互不相干：大屏发布、预测下发、每日增量各自单活。共用一把
    # 会让「大屏发布器在跑」顺带决定「今晚抽不抽增量」
    ac_publish_lease: Lease
    ac_daily_lease: Lease
    nodes: NodeWriter
    object_store: ObjectStore
    # 数据源口令的加解密器。密钥派生只在装配时做一次
    credential_cipher: CredentialCipher


def build_container(settings: Settings) -> Container:
    """按配置装配容器。

    Args: settings。
    """
    cache = Cache(url=settings.url(), timeout_s=settings.redis_timeout_s)
    database = _build_database(settings)
    history_database = _build_history_database(settings)
    viewer_database = _build_viewer_database(settings)
    pubsub = PubSub(url=settings.url(), timeout_s=settings.redis_timeout_s)
    transport = _build_command_transport(settings)
    return Container(
        settings=settings,
        database=database,
        ac_source=_build_ac_source(settings),
        stream=_build_stream(settings),
        cache=cache,
        idempotency=IdempotencyStore(cache=cache),
        module_catalog=load_module_catalog(),
        # 绑点的存在性由采集配置面的点位表回答：绑一个不存在的点位当场 400
        # 并指到字段，而不是静默放行一条永不产数据的绑定
        points=DatabasePointCatalog(sessions=database),
        history=ReadOnlyHistorySource(database=history_database),
        history_database=history_database,
        command_bus=_build_command_bus(settings, transport),
        command_transport=transport,
        plan_notifier=PlanNotifier(
            publisher=pubsub, channel=settings.collect_plan_channel
        ),
        pubsub=pubsub,
        snapshots=RedisSnapshotSource(
            url=settings.url(), timeout_s=settings.redis_timeout_s
        ),
        viewers=SubscriptionViewers(
            source=ReadOnlyViewerSource(database=viewer_database)
        ),
        collect_watchers=SubscriptionWatchers(
            source=ReadOnlyViewerSource(database=viewer_database)
        ),
        viewer_database=viewer_database,
        realtime=_build_realtime(settings),
        lease=_build_lease(settings, PUBLISHER_LEASE_KEY),
        ac_publish_lease=_build_lease(settings, AC_PUBLISH_LEASE_KEY),
        ac_daily_lease=_build_lease(settings, AC_DAILY_LEASE_KEY),
        nodes=_build_nodes(settings),
        # ⚠ 构造不连网：桶不存在要到第一次真正读写时才报，不在启动期误判
        object_store=create_object_store(settings),
        credential_cipher=_build_cipher(settings),
    )


def _build_cipher(settings: Settings) -> CredentialCipher:
    """数据源口令的加解密器。密钥派生只在装配时做一次。

    Args: settings。
    """
    return CredentialCipher(
        settings.collect_credential_secret.get_secret_value()
    )


def _build_nodes(settings: Settings) -> NodeWriter:
    """打 opcua-server 内部端点的客户端。⚠ 构造不连网。

    Args: settings。
    """
    return OpcuaClient(
        base_url=settings.opcua_base_url,
        service_key=settings.edge_service_key.get_secret_value(),
        timeout_s=settings.opcua_timeout_s,
    )


def _build_realtime(settings: Settings) -> RealtimeClient:
    """打 realtime-hub 内部端点的客户端。⚠ 构造不连网。

    Args: settings。
    """
    return RealtimeClient(
        base_url=settings.realtime_base_url,
        service_key=settings.edge_service_key.get_secret_value(),
        timeout_s=settings.realtime_timeout_s,
    )


def _build_lease(settings: Settings, key: str) -> Lease:
    """一把单活租约。⚠ 构造不连网。

    Args: settings, key。
    """
    return RedisLease(
        url=settings.url(),
        key=key,
        # ⚠ 令牌必须每个进程唯一：两个副本同名就会互相续到对方的租约上
        token=settings.app_instance,
        ttl_s=_ttl_of(settings, key),
        timeout_s=settings.redis_timeout_s,
    )


def _build_viewer_database(settings: Settings) -> Database:
    """hub 那张订阅表的只读连接池。

    ⚠ 独立一池且很小：发布循环每一拍问一次「谁在看」，而它问的是别人的
    schema（`realtime` 归 realtime-hub 写独占，ADR-0003）。
    ⚠ search_path 指向对方的 schema，但查询仍写完全限定的表名——配错时要的是
    「表不存在」，不是静默命中本服务 schema 里某张同名表。
    Args: settings。
    """
    return Database(
        dsn=settings.dsn(),
        profile=PoolProfile(
            pool_size=settings.publish_viewer_pool_size,
            max_overflow=0,
            connect_timeout_s=settings.postgres_connect_timeout_s,
            statement_timeout_ms=settings.postgres_statement_timeout_ms,
            lock_timeout_ms=settings.postgres_lock_timeout_ms,
        ),
        search_path=SUBSCRIPTION_SCHEMA,
    )


def _build_history_database(settings: Settings) -> Database:
    """归档宽表的只读连接池。

    ⚠ 独立一池：一次跨月的时序扫描不该把业务写连接连同它持有的锁一起占住。
    ⚠ search_path 指向归档 schema，但查询仍然写完全限定的表名——配错时要的是
    「表不存在」，不是静默命中本服务 schema 里某张同名表。
    Args: settings。
    """
    return Database(
        dsn=settings.dsn(),
        profile=PoolProfile(
            pool_size=settings.collect_history_pool_size,
            max_overflow=0,
            connect_timeout_s=settings.postgres_connect_timeout_s,
            statement_timeout_ms=settings.collect_history_statement_timeout_ms,
            lock_timeout_ms=settings.postgres_lock_timeout_ms,
        ),
        search_path=HISTORY_SCHEMA,
    )


def _build_command_transport(settings: Settings) -> RedisCommandTransport:
    """命令总线的传输面。⚠ 构造不连网。

    ⚠ `block_s` 取**最长**的那一档预算，不是浏览那一档：socket 超时是按它算
    出来的，比实际阻塞时长短就会在等应答等满一拍时被驱动层判成读超时——于是
    「现场还没答复」被报成「Redis 坏了」。
    Args: settings。
    """
    return RedisCommandTransport(
        url=settings.url(),
        block_s=max(
            settings.collect_browse_timeout_s,
            settings.collect_subtree_timeout_s,
        ),
    )


def _build_command_bus(
    settings: Settings, transport: RedisCommandTransport
) -> CommandBus:
    """命令总线的业务面。每个动作各有预算，且都不重试。

    Args: settings, transport。
    """
    return CommandBus(
        transport=transport,
        browse_timeout_s=settings.collect_browse_timeout_s,
        command_timeout_s=settings.collect_command_timeout_s,
        subtree_timeout_s=settings.collect_subtree_timeout_s,
    )


def _build_database(settings: Settings) -> Database:
    return Database(
        dsn=settings.dsn(),
        profile=PoolProfile(
            pool_size=settings.postgres_pool_size,
            max_overflow=settings.postgres_pool_overflow,
            connect_timeout_s=settings.postgres_connect_timeout_s,
            statement_timeout_ms=settings.postgres_statement_timeout_ms,
            lock_timeout_ms=settings.postgres_lock_timeout_ms,
        ),
        search_path=settings.postgres_schema,
    )


def _build_ac_source(settings: Settings) -> ReadOnlySqlSource:
    """外部只读数据源。⚠ 只跑 SELECT，不建表、不迁移，见 docs/adr/0006。

    Args: settings。
    """
    return ReadOnlySqlSource(
        dsn=settings.sqlserver_dsn(),
        profile=SourceProfile(
            pool_size=settings.sqlserver_pool_size,
            pool_recycle_s=settings.sqlserver_pool_recycle_s,
            login_timeout_s=settings.sqlserver_login_timeout_s,
            query_timeout_s=settings.sqlserver_query_timeout_s,
            charset=settings.sqlserver_charset,
        ),
    )


def _build_stream(settings: Settings) -> RedisStream:
    """抽取分片的队列。⚠ 构造不连网，API 角色不用它时也不会多一个连接。

    ⚠ 套接字超时必须**大于**阻塞读的时长，否则队列一空就必然超时：服务端正
    按约定挂起 `block_ms`，客户端却在 `redis_timeout_s` 就先放弃，于是空队列
    被报成故障。`redis_timeout_s` 是给一问一答的调用用的，不管阻塞读。
    Args: settings。
    """
    block_s = settings.acstartup_block_ms / 1000
    return RedisStream(
        url=settings.url(),
        timeout_s=max(settings.redis_timeout_s, block_s + STREAM_READ_MARGIN_S),
    )


def _ttl_of(settings: Settings, key: str) -> int:
    """这把租约的存活期。

    ⚠ 三条循环的节奏差着一个量级（大屏一秒一拍、下发一分钟一拍、增量一天
    一次），共用一个 TTL 会让慢的那条在两拍之间就把租约丢了。

    Args: settings, key。
    """
    if key == AC_PUBLISH_LEASE_KEY:
        return settings.acpublish_lease_ttl_s
    if key == AC_DAILY_LEASE_KEY:
        return settings.acdaily_lease_ttl_s
    return settings.publish_lease_ttl_s
