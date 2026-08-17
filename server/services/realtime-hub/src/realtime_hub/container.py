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
    FanoutListener,
    PublishService,
    SessionService,
    SubscriptionJournal,
    TopicRegistry,
    UserCodeSource,
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
    fanout: FanoutListener
    registry: TopicRegistry
    publisher: PublishService
    session: SessionService
    journal: SubscriptionJournal
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
    journal = SubscriptionJournal(
        database=database,
        crud=SubscriptionCrud(),
        replica=socket.gethostname(),
    )
    connections = ConnectionRegistry()
    catalog = CodeCatalog(
        base_url=settings.auth_base_url,
        service_key=settings.edge_service_key.get_secret_value(),
        timeout_s=settings.auth_timeout_s,
    )
    registry = TopicRegistry(database=database, catalog=catalog, topics=topics)
    pubsub = PubSub(url=settings.url(), timeout_s=settings.redis_timeout_s)
    parts = _Parts(
        database=database,
        topics=topics,
        journal=journal,
        connections=connections,
        registry=registry,
        pubsub=pubsub,
        user_codes=UserCodeSource(
            base_url=settings.auth_base_url,
            service_key=settings.edge_service_key.get_secret_value(),
            timeout_s=settings.auth_timeout_s,
        ),
    )
    return _assemble(settings, parts)


@dataclass(frozen=True)
class _Parts:
    """已经造好的协作对象。只为把装配拆成两段，本身不对外。"""

    database: Database
    topics: TopicCrud
    journal: SubscriptionJournal
    connections: ConnectionRegistry
    registry: TopicRegistry
    pubsub: PubSub
    user_codes: UserCodeSource


def _assemble(settings: Settings, parts: _Parts) -> Container:
    """把协作对象拼成容器。装配顺序仍在 `build_container` 里。

    Args: settings, parts。
    """
    database = parts.database
    pubsub = parts.pubsub
    connections = parts.connections
    registry = parts.registry
    journal = parts.journal
    topics = parts.topics
    return Container(
        settings=settings,
        database=database,
        cache=Cache(url=settings.url(), timeout_s=settings.redis_timeout_s),
        pubsub=pubsub,
        connections=connections,
        fanout=FanoutListener(
            pubsub=pubsub,
            connections=connections,
            channel=settings.fanout_channel,
        ),
        registry=registry,
        publisher=PublishService(
            database=database,
            pubsub=pubsub,
            topics=topics,
            channel=settings.fanout_channel,
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
            # ⚠ 权限码现查，不从令牌里读：签发方压根不往令牌里放它
            codes=parts.user_codes,
            registry=registry,
            connections=connections,
            journal=journal,
        ),
        journal=journal,
        replica=socket.gethostname(),
    )
