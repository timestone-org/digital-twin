"""组合根：把配置拧成各个协作对象。装配只在这里发生，模块顶层不做副作用。"""

import socket
from dataclasses import dataclass

from lib.auth import PasswordHasher
from lib.cache import Cache
from lib.db import Database, PoolProfile
from opcua_server.apps.instance.runtime.pki import PkiStore
from opcua_server.apps.instance.runtime.ports import PortAllocator
from opcua_server.apps.instance.runtime.supervisor import InstanceSupervisor
from opcua_server.apps.instance.services import (
    IdempotencyStore,
    InstanceService,
    NodeService,
    RealtimeClient,
    SecurityService,
)
from opcua_server.settings import Settings


@dataclass(frozen=True)
class Container:
    """一个进程内的全部长生命周期对象。"""

    settings: Settings
    database: Database
    cache: Cache
    supervisor: InstanceSupervisor
    instances: InstanceService
    nodes: NodeService
    security: SecurityService
    idempotency: IdempotencyStore
    realtime: RealtimeClient


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


def _build_supervisor(settings: Settings) -> InstanceSupervisor:
    """端口池与证书库都来自部署期配置，运行期不可扩。

    Args: settings。
    """
    return InstanceSupervisor(
        ports=PortAllocator(settings.ports()),
        pki=PkiStore(
            settings.pki_dir,
            valid_days=settings.cert_valid_days,
        ),
        max_instances=settings.max_instances,
    )


def _advertised_host() -> str:
    """展示给用户的 endpoint 主机名。

    ⚠ 实例绑的是 `0.0.0.0`，那个地址拼进 endpoint 给不了人任何信息。这里取
    主机名——它正是 asyncua 写进证书 SAN 的那个名字，两处一致，上位机据它
    校验也对得上。真实的对外地址取决于端口映射与网络拓扑，属于部署关切；
    需要覆盖时应当加一个 `OPCUA_ADVERTISED_HOST` 配置项，而不是在这里猜。
    """
    return socket.gethostname()


def build_container(settings: Settings) -> Container:
    """按配置装配容器。

    Args: settings。
    """
    database = _build_database(settings)
    cache = Cache(url=settings.url(), timeout_s=settings.redis_timeout_s)
    supervisor = _build_supervisor(settings)
    realtime = RealtimeClient(
        base_url=settings.realtime_base_url,
        service_key=settings.edge_service_key.get_secret_value(),
        timeout_s=settings.realtime_timeout_s,
    )
    return Container(
        settings=settings,
        database=database,
        cache=cache,
        supervisor=supervisor,
        instances=InstanceService(
            database=database,
            supervisor=supervisor,
            advertised_host=_advertised_host(),
            realtime=realtime,
        ),
        nodes=NodeService(database=database, supervisor=supervisor),
        security=SecurityService(
            database=database,
            supervisor=supervisor,
            hasher=PasswordHasher(),
        ),
        idempotency=IdempotencyStore(cache=cache),
        realtime=realtime,
    )
