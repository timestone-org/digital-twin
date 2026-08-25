"""组合根：把配置拧成各个协作对象。装配只在这里发生，模块顶层不做副作用。"""

from dataclasses import dataclass

from ai_assistant.llm import GuardedModel, build_model_source
from ai_assistant.settings import SERVICE_NAME, Settings
from ai_assistant.upstream import PlatformClient
from lib.cache import Cache
from lib.db import Database, PoolProfile
from lib.idempotency import IdempotencyStore
from lib.resilience import CircuitBreaker

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
    # ⚠ 没开模型时是 `None`，而不是一个「调了会报错」的壳：这与前端那套 ports
    # 范式同口径——能力缺席就如实缺席，由调用方决定怎么说这件事
    model: GuardedModel | None
    # 打业务面的客户端。⚠ 连接池一个进程一份、长活——每次调用现造一个再关掉，
    # 等于每次都重新握一次 TCP 手
    platform: PlatformClient


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


def _build_model(settings: Settings) -> GuardedModel | None:
    """按配置装模型；没开就不装。

    ⚠ 断路器一个进程一份、跟着模型一起活：每次调用现造一个的话它永远停在
    「closed」，等于没有断路器。

    Args: settings。
    """
    source = build_model_source(settings)
    if source is None:
        return None
    return GuardedModel(
        source=source,
        breaker=CircuitBreaker(
            name="model",
            failure_threshold=settings.model_breaker_failures,
            reset_after_s=settings.model_breaker_reset_s,
        ),
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
        model=_build_model(settings),
        platform=PlatformClient(
            base_url=settings.platform_base_url,
            timeout_s=settings.platform_timeout_s,
        ),
    )
