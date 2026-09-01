"""组合根：把配置拧成各个协作对象。装配只在这里发生，模块顶层不做副作用。"""

from dataclasses import dataclass, field

import httpx

from knowledge_server.apps.knowledge.services.embedding import (
    Embedder,
    build_embedder,
)
from knowledge_server.apps.knowledge.services.llm import (
    Answerer,
    build_answerer,
)
from knowledge_server.apps.knowledge.services.sources import (
    KnowledgeSource,
    SourceDeps,
    build_sources,
)
from knowledge_server.probe import IndexProbe
from knowledge_server.settings import SERVICE_NAME, Settings
from lib.cache import Cache
from lib.db import Database, PoolProfile
from lib.idempotency import IdempotencyStore
from lib.objectstore import ObjectStore, create_object_store
from lib.resilience import CircuitBreaker
from lib.stream import RedisStream, StreamGroup, StreamLike

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
    # 嵌入那一路。⚠ 没接时是 `NullEmbedder` 而不是 `None`：调用方于是不必
    # 写「这一路在不在」的分支，而缺席由 `can_embed` 如实说出来
    embedder: Embedder
    # 对话档。⚠ 没接时是 `NullAnswerer` 而不是 `None`：`agentic` 策略照样
    # 装得出来，只是它自己会如实说「用不了」
    answerer: Answerer
    # 打 platform 的客户端。⚠ 一个进程一份、长活：每次调用现造一个再关掉，
    # 等于每次都重新握一次 TCP 手
    platform: httpx.AsyncClient
    # 启动时探测填进去。⚠ 可变对象，故不带 frozen——它是这份容器里唯一
    # 「装配之后才知道」的东西
    index: IndexProbe = field(default_factory=IndexProbe)

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
        """
        if not self.settings.embedding_enabled:
            return (None, None)
        return (
            self.settings.embedding_model,
            self.settings.embedding_dimensions,
        )


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
        embedder=build_embedder(settings.embedding_endpoint()),
        answerer=build_answerer(
            settings.chat_endpoint(),
            # ⚠ 断路器一个进程一份、跟着容器活：每次调用现造一个的话它永远停在
            # 「closed」，等于没有断路器
            CircuitBreaker(
                name="knowledge:chat",
                failure_threshold=settings.model_breaker_failures,
                reset_after_s=settings.model_breaker_reset_s,
            ),
        ),
    )
