"""组合根：把配置拧成各个协作对象。装配只在这里发生，模块顶层不做副作用。"""

from dataclasses import dataclass

from ai_assistant.settings import SERVICE_NAME, Settings
from lib.cache import Cache
from lib.db import Database, PoolProfile
from lib.idempotency import IdempotencyStore

# 幂等键的命名空间。⚠ 必须带服务名：共用一个 Redis 的两个服务，同一个端点名
# 撞上同一个幂等键时会互相返回对方的结果
IDEMPOTENCY_NAMESPACE = SERVICE_NAME


@dataclass(frozen=True)
class Container:
    """一个进程内的全部长生命周期对象。"""

    settings: Settings
    database: Database
    cache: Cache
    idempotency: IdempotencyStore


def _build_database(settings: Settings) -> Database:
    """按连接池画像建库连接。

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
    """按配置装配容器。

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
    )
