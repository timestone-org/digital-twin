"""组合根：把配置拧成各个协作对象。装配只在这里发生，模块顶层不做副作用。"""

import socket
from dataclasses import dataclass

from lib.auth import JwtCodec
from lib.cache import Cache, PubSub
from lib.db import Database, PoolProfile
from realtime_hub.apps.channel.crud import SubscriptionCrud, TopicCrud
from realtime_hub.apps.channel.services import (
    CodeCatalog,
    ConnectionRegistry,
    PublishService,
    SessionService,
    TopicRegistry,
)
from realtime_hub.settings import Settings


@dataclass(frozen=True)
class Container:
    """一个进程内的全部长生命周期对象。"""

    settings: Settings
    database: Database
    cache: Cache
    pubsub: PubSub
    connections: ConnectionRegistry
    registry: TopicRegistry
    publisher: PublishService
    session: SessionService
    subscriptions: SubscriptionCrud
    # 本副本的标识。⚠ 用主机名：容器重启后它不变，正好用来清自己残留的订阅行
    replica: str


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


def build_container(settings: Settings) -> Container:
    """按配置装配容器。

    Args: settings。
    """
    database = _build_database(settings)
    topics = TopicCrud()
    connections = ConnectionRegistry()
    catalog = CodeCatalog(
        base_url=settings.auth_base_url,
        service_key=settings.edge_service_key.get_secret_value(),
        timeout_s=settings.auth_timeout_s,
    )
    registry = TopicRegistry(database=database, catalog=catalog, topics=topics)
    pubsub = PubSub(url=settings.url(), timeout_s=settings.redis_timeout_s)
    return Container(
        settings=settings,
        database=database,
        cache=Cache(url=settings.url(), timeout_s=settings.redis_timeout_s),
        pubsub=pubsub,
        connections=connections,
        registry=registry,
        publisher=PublishService(
            database=database,
            pubsub=pubsub,
            topics=topics,
            channel_of=settings.fanout_channel,
            max_items=settings.max_payload_items,
        ),
        session=SessionService(
            # ⚠ 只验不签：签发方是 auth-server，本服务拿不到也不需要签名密钥
            # 之外的任何东西。signing_key 传同一枚是 JwtCodec 的形状要求。
            codec=JwtCodec(
                signing_key=settings.jwt_secret.get_secret_value(),
                verification_keys=settings.verification_keys(),
                issuer=settings.jwt_issuer,
            ),
            registry=registry,
            connections=connections,
        ),
        subscriptions=SubscriptionCrud(),
        replica=socket.gethostname(),
    )
