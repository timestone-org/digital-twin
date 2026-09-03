"""组合根：把配置拧成各个协作对象。装配只在这里发生，模块顶层不做副作用。"""

from dataclasses import dataclass

from ai_assistant.llm import (
    DEFAULT_PROFILE,
    AdapterDeps,
    EmbeddingAdapter,
    GuardedModel,
    ModelRegistry,
    build_openai_embedding,
)
from ai_assistant.llm.breakers import BreakerBook
from ai_assistant.llm.codex import CodexRewire
from ai_assistant.llm.logins import PlatformLogins
from ai_assistant.settings import SERVICE_NAME, Settings
from ai_assistant.upstream import (
    AuthClient,
    DelegatedIdentity,
    KnowledgeClient,
    McpCatalog,
    McpClient,
    McpServer,
    PlatformClient,
)
from lib.cache import Cache
from lib.db import Database, PoolProfile
from lib.idempotency import IdempotencyStore
from lib.resilience import CircuitBreaker
from llmcore import CatalogCache, CatalogClient, CodexTokenClient

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
    # 给长回合的委托身份续签的客户端。⚠ 与 platform 分开一个字段只为关停时
    # 收得掉它的连接池；调用方一律经 platform，不直接用它
    auth: AuthClient
    # 这套部署接了哪几路模型。⚠ 与 `model` 分开：能力面要在模型关着时
    # 也能如实回答「这里本来能接哪几路」
    models: ModelRegistry
    # 外部 MCP 那一路的工具目录。⚠ 一个进程一份、长活：连接池与各路的断路器
    # 都要跨请求活着，每次现造一个的话断路器永远停在「closed」，等于没有它。
    # 没配任何一路时它仍在，只是 `servers` 是空的——空目录报空清单，
    # 与「装不上就如实缺席」同一口径
    mcp: McpCatalog
    # 要登录的那几路此刻登没登录（ADR-0041）。⚠ 只问不写：登录态归 platform，
    # 与那一路供应商同属主
    logins: PlatformLogins
    # 嵌入那一路（ADR-0030）。⚠ 没配时是 `None`：长期记忆仍然记得住
    # （存文本、标没有向量），只是检索用不了——能力缺席就如实缺席
    embedder: EmbeddingAdapter | None
    # 知识库读侧。⚠ 没配地址时是 `None`——那两个工具照样进规格表，
    # 由 `KnowledgeTools.run` 抛一句点得出名字的错
    knowledge: KnowledgeClient | None
    # 模型目录（ADR-0039）：平台上配的「各用途走哪一路模型」，按 TTL 重拉。
    # ⚠ 一个进程一份：注册表与嵌入那一路读的都是它的快照，各造一份的话
    # 两边看到的目录可以在同一次回合里不一样
    catalog: CatalogCache


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
    settings: Settings, registry: ModelRegistry, *, is_catalog_on: bool
) -> GuardedModel | None:
    """按配置装模型；一路都没接、目录也没接时才不装。

    ⚠ 目录在时**总是**装得出来：模型面是启动时装一次的，而目录是运行期可改的
    ——不装的话，在界面上新配出来的那一路要重启才用得上，而现象是「配好了、
    助手仍说没接模型」。

    ⚠ 断路器一个进程一份、跟着模型一起活：每次调用现造一个的话它永远停在
    「closed」，等于没有断路器。

    ⚠ **每一格 (档位, 用途) 各有一份断路器**：共用一份的话，订阅账号那一路
    挂掉会把按量那一路一起短路，而后者本来好好的。用途这一维同理——看图那一档
    可以配成另一家端点（`ASSISTANT_VISION_BASE_URL`），它连挂几次不该把同一路
    的对话一起短路掉，而那时用户看到的是「助手整个不能说话了」。

    ⚠ 那一本册子**按需生长**：档位来自运行期可改的目录，启动时一次建完的话，
    之后在界面上新配的那一路会落到兜底那一个上——于是一路挂掉会把别的路一起
    短路，而那几路本来好好的（`llm/breakers.py`）。

    Args: settings, registry, is_catalog_on。
    """
    if not is_catalog_on and not registry.adapters():
        return None
    return GuardedModel(
        source=registry.resolve,
        is_streaming=settings.model_stream_enabled,
        # ⚠ 订阅账号那几路要改线形（不认工具名里的点号）；外壳在 llmcore、
        # 两个服务共用，特例只能以钩子注进去。⚠ 「是不是那一路」问注册表而不是
        # 比字面量：档位名是目录里那一路的 id
        rewire=CodexRewire(is_codex=registry.is_codex),
        # 兜底那一份只在「档位认不出、用途也没登记」时用得上
        breaker=_breaker_of(settings, DEFAULT_PROFILE, "chat"),
        breakers=BreakerBook(
            lambda profile, kind: _breaker_of(settings, profile, kind)
        ),
    )


def _breaker_of(settings: Settings, profile: str, kind: str) -> CircuitBreaker:
    return CircuitBreaker(
        name=f"model:{profile}:{kind}",
        failure_threshold=settings.model_breaker_failures,
        reset_after_s=settings.model_breaker_reset_s,
    )


def _build_tokens(settings: Settings) -> CodexTokenClient:
    """订阅账号那一路的令牌来源：platform 的内部凭据面（ADR-0041）。

    ⚠ 构造不连网、也不判「这套部署有没有配」：目录里配没配订阅账号那一形态是
    运行期的事，而这一件在没有那一路时根本不会被调到。

    ⚠ 拿 `edge_service_key` 去打：与 platform 那边 `PLATFORM_EDGE_SERVICE_KEY`
    取同一个值，分叉就是每一次领令牌都 401、而两侧代码单看都对。

    Args: settings。
    """
    return CodexTokenClient(
        base_url=settings.platform_base_url,
        service_key=settings.edge_service_key.get_secret_value(),
        timeout_s=settings.llm_login_timeout_s,
    )


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
    tokens = _build_tokens(settings)
    # ⚠ 目录一个进程一份：注册表与嵌入那一路读的都是它的快照
    catalog = _build_catalog(settings)
    adapter_deps = AdapterDeps(
        settings=settings, tokens=tokens, catalog=catalog
    )
    # ⚠ 一个进程一份：造两份的话，两份各自的档位清单可以在将来漂开
    registry = ModelRegistry(adapter_deps)
    # ⚠ 也是一个进程一份：续签件把签好的头按用户缓存在自己身上，
    # 每请求现造一个的话每次调用都要再签一趟
    auth = AuthClient(
        base_url=settings.auth_base_url,
        service_key=settings.edge_service_key.get_secret_value(),
        timeout_s=settings.auth_timeout_s,
    )
    return Container(
        settings=settings,
        database=_build_database(settings),
        cache=cache,
        idempotency=IdempotencyStore(
            cache=cache, namespace=IDEMPOTENCY_NAMESPACE
        ),
        # ⚠ 目录一定在（`_build_catalog` 不会给 `None`），故模型面总是装得出来
        model=_build_model(settings, registry, is_catalog_on=True),
        platform=PlatformClient(
            base_url=settings.platform_base_url,
            timeout_s=settings.platform_timeout_s,
            identity=DelegatedIdentity(auth),
        ),
        auth=auth,
        models=registry,
        mcp=_build_mcp(settings),
        logins=PlatformLogins(tokens=tokens),
        embedder=build_openai_embedding(adapter_deps),
        knowledge=_build_knowledge(settings, auth),
        catalog=catalog,
    )


def _build_catalog(settings: Settings) -> CatalogCache:
    """模型目录的缓存（ADR-0039）。构造不连网，第一次拉在启动钩子里。

    ⚠ 拿 `edge_service_key` 去打 platform 的内部面：与 platform 那边
    `PLATFORM_EDGE_SERVICE_KEY` 取同一个值，分叉就是目录永远拉不到、
    而两侧代码单看都对。

    Args: settings。
    """
    return CatalogCache(
        CatalogClient(
            base_url=settings.platform_base_url,
            service_key=settings.edge_service_key.get_secret_value(),
            timeout_s=settings.llm_catalog_timeout_s,
        ),
        ttl_s=settings.llm_catalog_refresh_s,
    )


def _build_knowledge(
    settings: Settings, auth: AuthClient
) -> KnowledgeClient | None:
    """按配置装知识库读侧；没配地址就是这套部署没接它。

    ⚠ 与 platform 同样接上 `DelegatedIdentity`：一个回合能跑几分钟，而边缘签的
    那组头只有几十秒——不续的话回合后半段每一次检索都是 401，而现象是
    「knowledge.search 没跑成」，原因却在身份头上。

    Args: settings, auth。
    """
    if not settings.knowledge_base_url.strip():
        return None
    return KnowledgeClient(
        base_url=settings.knowledge_base_url,
        timeout_s=settings.knowledge_timeout_s,
        identity=DelegatedIdentity(auth),
    )
