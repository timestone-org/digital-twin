"""层级图服务组合根。"""

from dataclasses import dataclass

from hierarchy_server.settings import Settings
from lib.cache import Cache
from lib.db import Database, PoolProfile
from lib.idempotency import IdempotencyStore


@dataclass(frozen=True)
class Container:
    """一个进程一份的协作件：配置、连接池、缓存与幂等存储。"""

    settings: Settings
    database: Database
    cache: Cache
    idempotency: IdempotencyStore


def build_container(settings: Settings) -> Container:
    """装配连接池与幂等存储。Args: settings。"""
    database = Database(
        dsn=settings.dsn(),
        search_path=settings.postgres_schema,
        profile=PoolProfile(
            pool_size=settings.postgres_pool_size,
            max_overflow=settings.postgres_pool_overflow,
            connect_timeout_s=settings.postgres_connect_timeout_s,
            statement_timeout_ms=settings.postgres_statement_timeout_ms,
            lock_timeout_ms=settings.postgres_lock_timeout_ms,
        ),
    )
    cache = Cache(url=settings.url(), timeout_s=settings.redis_timeout_s)
    return Container(
        settings=settings,
        database=database,
        cache=cache,
        idempotency=IdempotencyStore(cache, "hierarchy"),
    )
