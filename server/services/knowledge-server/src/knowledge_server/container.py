"""组合根：把配置拧成各个协作对象。装配只在这里发生，模块顶层不做副作用。"""

from dataclasses import dataclass, field

from knowledge_server.settings import SERVICE_NAME, Settings
from lib.cache import Cache
from lib.db import Database, PoolProfile
from lib.idempotency import IdempotencyStore
from lib.objectstore import ObjectStore, create_object_store

# 幂等键的命名空间。⚠ 必须带服务名：共用一个 Redis 的两个服务，同一个端点名
# 撞上同一个幂等键时会互相返回对方的结果
IDEMPOTENCY_NAMESPACE = SERVICE_NAME


@dataclass
class IndexProbe:
    """库里到底装了哪几样加速件——启动时问一次，之后不再问。

    ⚠ 这几格**不是配置**，是探测结果。配置说的是「想用哪一档」，这里说的是
    「此刻真能用哪一档」，两者不一致时以这里为准，并如实上 `/capabilities`
    （ADR-0034 决策四、决策五）。

    ⚠ 探测放在启动而不是每次检索：每次检索问一遍是一次多余的往返，
    而扩展装没装这件事在进程活着的这段时间里不会变。
    """

    # `vector` 扩展在不在，以及加速表建没建
    has_pgvector: bool = False
    has_vector_table: bool = False
    # `pg_trgm` 在不在
    has_trgm: bool = False
    # 探测本身失败了吗。⚠ 与「探测到没装」分开：前者是我们不知道，
    # 后者是我们知道它没装，而两者该说的话不一样
    is_probed: bool = False


@dataclass(frozen=True)
class Container:
    """一个进程内的全部长生命周期对象。"""

    settings: Settings
    database: Database
    cache: Cache
    idempotency: IdempotencyStore
    # 上传来源的原件落点。⚠ 一个进程一份、长活：每次调用现造一个客户端，
    # 等于每次都重新握一次手
    objectstore: ObjectStore
    # 启动时探测填进去。⚠ 可变对象，故不带 frozen——它是这份容器里唯一
    # 「装配之后才知道」的东西
    index: IndexProbe = field(default_factory=IndexProbe)


def _build_database(settings: Settings) -> Database:
    """按连接池画像建库连接。

    ⚠ worker 角色的池子不必与 api 同大小：它的并发由消费循环的批量决定，
    而 api 的并发由请求量决定。共用一份的表现是 worker 常年占着十条空闲连接。

    Args: settings。
    """
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


def build_container(settings: Settings) -> Container:
    """按配置装出这一次运行要用的全部长生命周期对象。

    Args: settings。
    """
    cache = Cache(url=settings.url(), timeout_s=settings.redis_timeout_s)
    return Container(
        settings=settings,
        database=_build_database(settings),
        cache=cache,
        idempotency=IdempotencyStore(
            cache=cache, namespace=IDEMPOTENCY_NAMESPACE
        ),
        objectstore=create_object_store(settings),
    )
