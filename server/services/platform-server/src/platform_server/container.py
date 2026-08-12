"""组合根：把配置拧成各个协作对象。装配只在这里发生，模块顶层不做副作用。"""

from dataclasses import dataclass

from lib.db import Database, PoolProfile, ReadOnlySqlSource, SourceProfile
from platform_server.settings import Settings
from platform_server.stream import RedisStream


@dataclass(frozen=True)
class Container:
    """一个进程内的全部长生命周期对象。"""

    settings: Settings
    database: Database
    ac_source: ReadOnlySqlSource
    stream: RedisStream


def build_container(settings: Settings) -> Container:
    """按配置装配容器。

    Args: settings。
    """
    return Container(
        settings=settings,
        database=_build_database(settings),
        ac_source=_build_ac_source(settings),
        stream=_build_stream(settings),
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

    Args: settings。
    """
    return RedisStream(url=settings.url(), timeout_s=settings.redis_timeout_s)
