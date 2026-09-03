"""组合根：把配置拧成各个协作对象。装配只在这里发生，模块顶层不做副作用。

⚠ 嵌入档与对话档**先问模型目录、再退环境变量**（ADR-0039）：目录是平台上配的
「各用途走哪一路模型」，运行期可改；环境变量是它的永久默认值。两路的适配器都按
「此刻装得出来吗」如实回答可用性，装配期不再钉死。

⚠ 对话档按**接入形态**查一张显式的表（`llm_adapters.KIND_BUILDERS`，ADR-0041）：
订阅账号那一路的登录态归 platform，本服务经内部面领令牌、只领不刷。
"""

from dataclasses import dataclass, field

import httpx
from langchain_core.language_models import BaseChatModel

from knowledge_server.apps.knowledge.services.embedding import (
    Embedder,
    build_dynamic_embedder,
)
from knowledge_server.apps.knowledge.services.llm import (
    Answerer,
    build_answerer,
)
from knowledge_server.apps.knowledge.services.reranking import (
    Reranker,
    build_reranker,
)
from knowledge_server.apps.knowledge.services.sources import (
    KnowledgeSource,
    SourceDeps,
    build_sources,
)
from knowledge_server.llm_adapters import AdapterDeps, CatalogChatAdapter
from knowledge_server.llm_purposes import PURPOSE_EMBEDDING, PURPOSE_RERANK
from knowledge_server.schema import SchemaFacts
from knowledge_server.settings import SERVICE_NAME, Settings
from lib.cache import Cache
from lib.db import Database, PoolProfile
from lib.idempotency import IdempotencyStore
from lib.objectstore import ObjectStore, create_object_store
from lib.resilience import CircuitBreaker
from lib.stream import RedisStream, StreamGroup, StreamLike
from llmcore import (
    CatalogCache,
    CatalogClient,
    CodexTokenClient,
    DynamicEmbeddingAdapter,
    DynamicRerankAdapter,
    EmbeddingEndpoint,
    ModelChoice,
    ModelDisabled,
    RerankEndpoint,
)
from llmcore.codex import CodexRewire
from llmcore.guard import GuardedModel

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
    # 上传来源的原件落点。⚠ 一个进程一份、长活：每次调用现造一个客户端，
    # 等于每次都重新握一次手
    objectstore: ObjectStore
    # 摄取队列。⚠ api 侧投、worker 侧消费，一个进程一份、长活：每次现造一个
    # 客户端等于每次都重新握一次手
    stream: StreamLike
    # 接了哪几路知识来源。⚠ 顺序即界面上的先后
    sources: tuple[KnowledgeSource, ...]
    # 嵌入那一路。⚠ 没接时 `can_embed` 为假而不是 `None`：调用方于是不必
    # 写「这一路在不在」的分支，而缺席由 `can_embed` 如实说出来
    embedder: Embedder
    # 对话档。⚠ 没接时 `can_answer` 为假而不是 `None`：`agentic` 策略照样
    # 装得出来，只是它自己会如实说「用不了」
    answerer: Answerer
    # 重排那一路（ADR-0042）。⚠ 没接时 `can_rerank` 为假而不是 `None`：
    # 检索照常返回融合名次，而「接没接」由 `/capabilities` 如实回答
    reranker: Reranker
    # 打 platform 的客户端。⚠ 一个进程一份、长活：每次调用现造一个再关掉，
    # 等于每次都重新握一次 TCP 手
    platform: httpx.AsyncClient
    # 模型目录（ADR-0039）：平台上配的「各用途走哪一路模型」，按 TTL 重拉。
    # ⚠ 一个进程一份：嵌入与对话两路读的都是它的快照
    catalog: CatalogCache
    # 对话面用的带断路器的模型调用面。⚠ 这一路此刻装不出来时它抛
    # `ModelDisabled`，对话入口按 `answerer.can_answer` 先判一次再进回合
    responder: GuardedModel
    # 库上那几件启动之后才知道的事（向量列的维数）。⚠ 可变对象，故不带 frozen：
    # 它是这份容器里唯一「装配之后才填得出来」的东西
    schema: SchemaFacts = field(default_factory=SchemaFacts)

    def ingest_group(self) -> StreamGroup:
        """摄取队列的消费组身份。

        ⚠ 消费者名带实例号：同一个组里两个消费者同名的话，`XAUTOCLAIM`
        会把对方手上还在跑的消息认领过来，于是同一份文档被两个进程一起解。
        """
        return StreamGroup(
            stream=self.settings.ingest_stream,
            group=self.settings.ingest_group,
            consumer=self.settings.app_instance,
        )

    def embedding_choice(self) -> tuple[str | None, int | None]:
        """建库那一刻此刻接得上的嵌入档（模型名, 维数）。

        ⚠ 没接时两格都是 `None`，而不是填一个「将来大概会用」的名字：
        填了的话，库上写着一路根本没算过的模型名，而检索会以为它已经建过索引。
        ⚠ 问的是嵌入那一路**此刻**解出的端点，不是环境变量：目录里分配了
        别的模型时，环境变量那一格早已不是真正会算向量的那一个。
        """
        if not self.embedder.can_embed:
            return (None, None)
        return (self.embedder.model, self.embedder.dimensions)


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
    store = create_object_store(settings)
    platform = httpx.AsyncClient(
        base_url=settings.platform_base_url,
        timeout=settings.platform_timeout_s,
    )
    catalog = _build_catalog(settings)
    chat_breaker = CircuitBreaker(
        name="knowledge:chat",
        failure_threshold=settings.model_breaker_failures,
        reset_after_s=settings.model_breaker_reset_s,
    )
    chat_adapter = _chat_adapter(settings, catalog)
    return Container(
        settings=settings,
        database=_build_database(settings),
        cache=cache,
        idempotency=IdempotencyStore(
            cache=cache, namespace=IDEMPOTENCY_NAMESPACE
        ),
        objectstore=store,
        stream=RedisStream(
            url=settings.url(), timeout_s=settings.redis_timeout_s
        ),
        platform=platform,
        # ⚠ 这一份是**不带身份头**的：能力面报「接了哪几路来源」用得着它，
        # 而真要代表用户去拉数据时，api 侧会按请求另造一份带头的
        sources=build_sources(SourceDeps(store=store, platform=platform)),
        embedder=build_dynamic_embedder(
            DynamicEmbeddingAdapter(
                resolve=lambda: _embedding_endpoint(settings, catalog),
                refresh=catalog.refresh,
            ),
            settings.embedding_max_input_tokens,
        ),
        catalog=catalog,
        # ⚠ 断路器一个进程一份、跟着容器活，且 `:ask` 与对话面**共用**这一份：
        # 它们打的是同一个端点，那个端点不行就是整个不行
        answerer=build_answerer(
            chat_adapter, chat_breaker, refresh=catalog.refresh
        ),
        reranker=_build_reranker(settings, catalog),
        responder=_build_responder(chat_adapter, chat_breaker, catalog),
    )


def _build_catalog(settings: Settings) -> CatalogCache:
    """模型目录的缓存。构造不连网，第一次拉在启动钩子里。

    ⚠ 拿 `edge_service_key` 去打 platform 的内部面：与 platform 那边
    `PLATFORM_EDGE_SERVICE_KEY` 取同一个值，分叉就是目录永远拉不到。

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


def _chat_adapter(
    settings: Settings, catalog: CatalogCache
) -> CatalogChatAdapter:
    """对话档的适配器：走哪一路由目录在**调用时**挑（ADR-0041）。

    Args: settings, catalog。
    """
    return CatalogChatAdapter(
        deps=AdapterDeps(
            settings=settings, catalog=catalog, tokens=_build_tokens(settings)
        )
    )


def _build_tokens(settings: Settings) -> CodexTokenClient:
    """订阅账号那一路的令牌来源：platform 的内部凭据面（ADR-0041）。

    ⚠ 构造不连网，也不判「这套部署配没配」：目录里有没有那一形态是运行期的事，
    而这一件在没有那一路时根本不会被调到。

    ⚠ 拿 `edge_service_key` 去打：与 platform 那边 `PLATFORM_EDGE_SERVICE_KEY`
    取同一个值，分叉就是每一次领令牌都 401、而两侧代码单看都对。

    Args: settings。
    """
    return CodexTokenClient(
        base_url=settings.platform_base_url,
        service_key=settings.edge_service_key.get_secret_value(),
        timeout_s=settings.llm_login_timeout_s,
    )


def _embedding_endpoint(
    settings: Settings, catalog: CatalogCache
) -> EmbeddingEndpoint | None:
    """嵌入档此刻该打哪：目录优先，否则退环境变量。

    Args: settings, catalog。
    """
    from_catalog = catalog.snapshot().embedding_endpoint(
        PURPOSE_EMBEDDING, timeout_s=settings.embedding_timeout_s
    )
    return from_catalog or settings.embedding_endpoint()


def _rerank_endpoint(
    settings: Settings, catalog: CatalogCache
) -> RerankEndpoint | None:
    """重排档此刻该打哪；没分配即这套部署没接这一路。

    ⚠ 只有目录一个来源，没有环境变量那一档：多一条回退链就多一处
    「配了没生效」要排查的地方，而这一路没有任何存量部署靠环境变量配着它。

    Args: settings, catalog。
    """
    return catalog.snapshot().rerank_endpoint(
        PURPOSE_RERANK, timeout_s=settings.rerank_timeout_s
    )


def _build_reranker(settings: Settings, catalog: CatalogCache) -> Reranker:
    """重排那一路。端点由目录在调用时解出，没分配即这套部署没接。

    ⚠ 断路器单开一个：它与对话档打的不是同一个端点，共用一份的话，
    重排端点连挂几次会把对话面一起短路掉。

    Args: settings, catalog。
    """
    return build_reranker(
        DynamicRerankAdapter(
            resolve=lambda: _rerank_endpoint(settings, catalog),
            refresh=catalog.refresh,
        ),
        CircuitBreaker(
            name="knowledge:rerank",
            failure_threshold=settings.model_breaker_failures,
            reset_after_s=settings.model_breaker_reset_s,
        ),
    )


def _build_responder(
    adapter: CatalogChatAdapter,
    breaker: CircuitBreaker,
    catalog: CatalogCache,
) -> GuardedModel:
    """对话面的模型调用面。

    ⚠ 这一路此刻装不出来时抛 `ModelDisabled`，而不是让适配器撞一条编排错：
    前者是「没接对话档」，回给用户的是一句点得出名字的话。

    ⚠ 订阅账号那一路要改工具名的线形（它不认点号，而本服务的工具名是
    `kb.search` 这样的）。「此刻是不是那一路」问适配器而不是比档位名：这一侧
    只有一个档位，走哪一路由目录说了算——按档位名比的话，配了订阅账号之后
    每一次带工具的对话都撞一条 400，而那条 400 里不会提到点号。

    Args: adapter, breaker, catalog。
    """

    async def source(choice: ModelChoice) -> BaseChatModel:
        await catalog.refresh()
        if not adapter.supports("chat"):
            raise ModelDisabled("这套部署没有接对话档")
        return await adapter.build(choice)

    return GuardedModel(
        source=source,
        breaker=breaker,
        rewire=CodexRewire(is_codex=lambda _profile: adapter.is_codex_now()),
    )
