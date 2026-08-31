"""组合根：把配置拧成各个协作对象。装配只在这里发生，模块顶层不做副作用。"""

from dataclasses import dataclass

import httpx

from ai_assistant.apps.credential.services import (
    HTTP_TIMEOUT_S,
    CredentialStore,
    DeviceLogin,
    OAuthClient,
)
from ai_assistant.llm import (
    DEFAULT_PROFILE,
    MODEL_KINDS,
    GuardedModel,
    ModelRegistry,
)
from ai_assistant.settings import SERVICE_NAME, Settings
from ai_assistant.upstream import (
    McpCatalog,
    McpClient,
    McpServer,
    PlatformClient,
)
from lib.cache import Cache
from lib.crypto import SecretCipher
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
    # 这套部署接了哪几路模型。⚠ 与 `model` 分开：能力面要在模型关着时
    # 也能如实回答「这里本来能接哪几路」
    models: ModelRegistry
    # 外部 MCP 那一路的工具目录。⚠ 一个进程一份、长活：连接池与各路的断路器
    # 都要跨请求活着，每次现造一个的话断路器永远停在「closed」，等于没有它。
    # 没配任何一路时它仍在，只是 `servers` 是空的——空目录报空清单，
    # 与「装不上就如实缺席」同一口径
    mcp: McpCatalog
    # 订阅账号那一路的凭据读写与登录。没开 codex 时同样是 `None`
    credentials: CredentialStore | None
    device_login: DeviceLogin | None
    # 打 OAuth 端点的 http 客户端。⚠ 与凭据一起活：没开 codex 时不建，
    # 建了就要在关停时收掉（见 app.py 的 lifespan 钩子）
    oauth_http: httpx.AsyncClient | None


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


def _build_model(
    settings: Settings, registry: ModelRegistry
) -> GuardedModel | None:
    """按配置装模型；一路都没接就不装。

    ⚠ 断路器一个进程一份、跟着模型一起活：每次调用现造一个的话它永远停在
    「closed」，等于没有断路器。

    ⚠ **每一格 (档位, 用途) 各有一份断路器**：共用一份的话，订阅账号那一路
    挂掉会把按量那一路一起短路，而后者本来好好的。用途这一维同理——看图那一档
    可以配成另一家端点（`ASSISTANT_VISION_BASE_URL`），它连挂几次不该把同一路
    的对话一起短路掉，而那时用户看到的是「助手整个不能说话了」。

    Args: settings, registry。
    """
    profiles = registry.profiles()
    if not profiles:
        return None
    return GuardedModel(
        source=registry.resolve,
        is_streaming=settings.model_stream_enabled,
        # 兜底那一份只在「档位认不出、用途也没登记」时用得上
        breaker=_breaker_of(settings, DEFAULT_PROFILE, "chat"),
        breakers={
            (one.id, kind): _breaker_of(settings, one.id, kind)
            for one in profiles
            for kind in MODEL_KINDS
        },
    )


def _breaker_of(settings: Settings, profile: str, kind: str) -> CircuitBreaker:
    return CircuitBreaker(
        name=f"model:{profile}:{kind}",
        failure_threshold=settings.model_breaker_failures,
        reset_after_s=settings.model_breaker_reset_s,
    )


def _build_codex(
    settings: Settings, database: Database, cache: Cache
) -> tuple[
    CredentialStore | None, DeviceLogin | None, httpx.AsyncClient | None
]:
    """按配置装订阅账号那一路；没开就三个都不建。

    ⚠ 密钥在这里已经保证有了：`Settings` 的校验器兜着「开了 codex 却没配
    密钥 → 启动即退出」，所以这里不需要再写一条「没配就降级」的分支——
    写了反而会让配置漏填悄悄变成「登录不了但服务起着」。

    Args: settings, database, cache。
    """
    secret = settings.credential_secret
    if not settings.codex_enabled or secret is None:
        return (None, None, None)
    # ⚠ 客户端自己也带超时：逐个请求写的那份只兜住走 `_post` 的路径，
    # 而「每个跨进程调用必须有超时」守的是整条连接
    http = httpx.AsyncClient(timeout=HTTP_TIMEOUT_S)
    store = CredentialStore(
        sessions=database.session,
        cipher=SecretCipher(
            secret.get_secret_value(), label="model-credential"
        ),
        oauth=OAuthClient(http),
        cache=cache,
    )
    login = DeviceLogin(oauth=OAuthClient(http), cache=cache, store=store)
    return (store, login, http)


def _build_mcp(settings: Settings) -> McpCatalog:
    """按配置装出 MCP 目录。一路一个断路器。

    ⚠ 断路器**按 server 分**，不共用一个：一个 server 挂掉不该把其余几路一起
    短路，而它们本来好好的（ADR-0031 决策四）。

    Args: settings。
    """
    servers = tuple(
        McpServer(
            name=str(one["name"]),
            url=str(one["url"]),
            is_auth_required=bool(one.get("is_auth_required")),
        )
        for one in settings.mcp_server_list()
    )
    return McpCatalog(
        client=McpClient(timeout_s=settings.mcp_timeout_s),
        servers=servers,
        tokens=settings.mcp_token_map(),
        breakers={
            one.name: CircuitBreaker(
                name=f"mcp:{one.name}",
                failure_threshold=settings.mcp_breaker_failures,
                reset_after_s=settings.mcp_breaker_reset_s,
            )
            for one in servers
        },
    )


def build_container(settings: Settings) -> Container:
    """按配置装配容器。

    Args: settings。
    """
    cache = Cache(url=settings.url(), timeout_s=settings.redis_timeout_s)
    database = _build_database(settings)
    credentials, device_login, oauth_http = _build_codex(
        settings, database, cache
    )
    # ⚠ 一个进程一份：造两份的话，两份各自的档位清单可以在将来漂开
    registry = ModelRegistry(settings, tokens=credentials)
    return Container(
        settings=settings,
        database=database,
        cache=cache,
        idempotency=IdempotencyStore(
            cache=cache, namespace=IDEMPOTENCY_NAMESPACE
        ),
        model=_build_model(settings, registry),
        platform=PlatformClient(
            base_url=settings.platform_base_url,
            timeout_s=settings.platform_timeout_s,
        ),
        models=registry,
        mcp=_build_mcp(settings),
        credentials=credentials,
        device_login=device_login,
        oauth_http=oauth_http,
    )
