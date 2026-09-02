"""knowledge-server 的配置。继承 lib 的基类，只加本服务字段。

变量名 = `KNOWLEDGE_<组>_<键>`。密钥类一律无默认值——缺失即拒绝启动。
"""

from typing import Literal, Self

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import SettingsConfigDict

from lib.config import AppSettings, PostgresSettings, RedisSettings
from lib.objectstore import ObjectStoreSettings
from llmcore import ChatEndpoint, EmbeddingEndpoint

SERVICE_NAME = "knowledge-server"
API_PREFIX = "/api/v1/knowledge"
INTERNAL_PREFIX = "/internal/v1/knowledge"
DB_SCHEMA = "knowledge"
HTTP_PORT = 8009

# 对话面的历史窗口高水位与一次脱落几条（`llmcore.memory.history`）。
# ⚠ 是常量不是配置：按环境改行为会让两套部署跑出两种对话
MAX_HISTORY_MESSAGES = 40
HISTORY_DROP_STEP = 10

ROLE_API = "api"
ROLE_WORKER = "worker"

# 索引档的取值。⚠ `auto` 是**探测**，不是「猜」：启动时问一次库装没装扩展，
# 据此选实现。三个取值走的是同一段代码的不同实现，不是环境分支
IndexChoice = Literal["auto", "pgvector", "bruteforce"]
KeywordChoice = Literal["auto", "trgm", "like"]

# 一个块最多多少字符。⚠ 有上限：嵌入端点按 token 收费也按 token 截断，
# 超了那一截**不报错**，只是没进向量——表现是「这一段怎么都检索不到」
MAX_CHUNK_CHARS = 2_000
# 相邻块的重叠字符数。⚠ 不能是 0：切在句子中间的那一刀会让两边都答不出
# 跨刀的问题，而它看起来只是「这个问题模型不会」
CHUNK_OVERLAP_CHARS = 200
# 一次检索最多回多少条
MAX_RETRIEVAL_HITS = 50
# 一份原件最大多少字节。⚠ 有上限：一份几百兆的文件会把 worker 的内存吃干，
# 而倒下的不只是这一次摄取
MAX_RAW_BYTES = 64 * 1024 * 1024


class MigrationSettings(PostgresSettings):
    """迁移只需要连库这一组。

    ⚠ 刻意**不**继承完整 `Settings`：跑一次建表与 Redis、对象存储、模型端点
    毫无关系，而配置的口径是「缺一个就退出」。让迁移依赖整份配置的后果是——
    任何只配了数据库的场合（CI 的迁移作业、部署时先建表再起服务、本地对着空库
    验可逆性）都会以「Field required」失败，而报出来的字段与建表这件事完全对
    不上号。这条在 opcua-server 上真踩过（#26）。
    """

    model_config = SettingsConfigDict(
        env_prefix="KNOWLEDGE_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
    )

    postgres_schema: str = DB_SCHEMA


class Settings(
    AppSettings, PostgresSettings, RedisSettings, ObjectStoreSettings
):
    """进程启动时构造一次并冻结。"""

    model_config = SettingsConfigDict(
        env_prefix="KNOWLEDGE_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
    )

    app_name: str = SERVICE_NAME
    app_http_port: int = HTTP_PORT
    postgres_schema: str = DB_SCHEMA

    # 边缘注入的身份头由这枚密钥签名，本服务验它、并原样转发给 platform
    edge_signing_secret: SecretStr = Field(min_length=32)
    # 内部端点之间的服务级密钥
    edge_service_key: SecretStr = Field(min_length=32)

    # 上游业务面。外部系统来源经它取数，**不读别人的库**
    platform_base_url: str = "http://platform-server:8005"
    platform_timeout_s: float = 10.0

    # 嵌入档。关着时文档照常摄取，检索如实回答「这个库还没建索引」——
    # 不是返回空表，空表与「确实没有相关内容」长得一模一样
    embedding_enabled: bool = False
    embedding_base_url: str = ""
    embedding_api_key: SecretStr | None = None
    embedding_model: str = ""
    embedding_dimensions: int = 1536
    embedding_timeout_s: float = 30.0
    # 一次嵌入调用最多带几段。⚠ 有上限：端点对单次请求的总 token 有限，
    # 超了整批失败，而失败的是「这一次摄取」不是「这一段」
    embedding_batch_size: int = 16

    # agentic 检索策略要的对话档。关着时那个策略如实不可用
    model_enabled: bool = False
    model_base_url: str = ""
    model_api_key: SecretStr | None = None
    model_chat: str = ""
    model_timeout_s: float = 60.0
    # 断路器。⚠ 只有「下游此刻不行」那一档让它计数：401/403/400 一律不计——
    # 断路器一开，真正的原因就被盖成「暂时不可用」，而那会让人去查网络
    model_breaker_failures: int = 5
    model_breaker_reset_s: float = 30.0

    # 摄取队列。⚠ 与 worker 侧读的是同一对，改一处不改另一处的表现是
    # 「投得进去、没人消费」，而两边单看都对
    ingest_stream: str = "knowledge:ingest"
    ingest_group: str = "knowledge-ingest-workers"
    # 一条消息滞留多久算掉队，由别的消费者认领
    ingest_claim_idle_ms: int = 5 * 60 * 1000
    ingest_block_ms: int = 5_000
    ingest_batch: int = 1
    # 一份文档解析多久算卡死。⚠ 必须有：没有超时的解析会把这条消费循环
    # 永久占住，而现象是「队列不动了」，看不出是哪一份文档导致的
    parse_timeout_s: float = 10 * 60

    # 索引档，见 ADR-0034
    vector_index: IndexChoice = "auto"
    keyword_index: KeywordChoice = "auto"

    # 语音输入：到自建 FunASR 的中继（ADR-0038）。关着时 `/speech/ws` 一律
    # 以 1013 关掉，`/capabilities` 如实报 `is_asr_enabled=false`
    asr_enabled: bool = False
    # ws:// 或 wss://。⚠ 现场多半是明文 ws——它只在本服务与 FunASR 之间走，
    # 浏览器那一段仍是 wss 到边缘
    asr_url: str = ""
    # 原样塞进 FunASR 的 hotwords
    asr_hotwords: str = ""
    asr_connect_timeout_s: float = 5.0
    # stop 之后等终稿多久；到点就把手头的当 final 发出去
    asr_final_timeout_s: float = 5.0
    # 浏览器多久不送帧就当它走了
    asr_idle_timeout_s: float = 30.0
    # 一句话最长多久，超了当 stop
    asr_max_utterance_s: float = 60.0
    # 收口前补多长的尾部静音。⚠ FunASR 靠 VAD 判「说完了」，尾部静音不够长
    # 它判不出来、不给终稿——本部署实测 1.5 s 不够、3 s 够；太短的表现是
    # 每一句都要等到超时才拿到不带标点的在线整段
    asr_tail_silence_s: float = Field(default=3.0, gt=0)

    @model_validator(mode="after")
    def _embedding_needs_a_key_and_a_model(self) -> Self:
        """开了嵌入档就必须把端点配全，否则启动即失败。

        ⚠ 不打 WARN 继续：留到第一次摄取才发现的话，服务已经接了流量，
        而表现是「文档状态一直停在 embedding」。
        """
        if not self.embedding_enabled:
            return self
        missing = [
            name
            for name, given in (
                ("KNOWLEDGE_EMBEDDING_BASE_URL", self.embedding_base_url),
                ("KNOWLEDGE_EMBEDDING_MODEL", self.embedding_model),
            )
            if not given.strip()
        ]
        if self.embedding_api_key is None:
            missing.append("KNOWLEDGE_EMBEDDING_API_KEY")
        if missing:
            raise ValueError(f"开了嵌入档就必须配：{'、'.join(missing)}")
        return self

    @model_validator(mode="after")
    def _model_needs_a_key_and_a_name(self) -> Self:
        """开了对话档就必须把端点配全，否则启动即失败。

        ⚠ 与嵌入档分开判：两者可以只开一个——只做混合检索不做 agentic 时，
        对话档整个用不上。
        """
        if not self.model_enabled:
            return self
        missing = [
            name
            for name, given in (
                ("KNOWLEDGE_MODEL_BASE_URL", self.model_base_url),
                ("KNOWLEDGE_MODEL_CHAT", self.model_chat),
            )
            if not given.strip()
        ]
        if self.model_api_key is None:
            missing.append("KNOWLEDGE_MODEL_API_KEY")
        if missing:
            raise ValueError(f"开了对话档就必须配：{'、'.join(missing)}")
        return self

    @model_validator(mode="after")
    def _asr_needs_a_ws_url(self) -> Self:
        """开了语音识别就必须给一个 ws:// 或 wss:// 的地址，否则启动即失败。

        ⚠ 不打 WARN 继续：留到第一次开麦才发现的话，用户看到的只是
        「语音识别此刻不可用」，而那句话与 FunASR 真挂了长得一模一样。
        """
        if not self.asr_enabled:
            return self
        url = self.asr_url.strip()
        if not url:
            raise ValueError("开了语音识别就必须配 KNOWLEDGE_ASR_URL")
        if not url.startswith(("ws://", "wss://")):
            raise ValueError("KNOWLEDGE_ASR_URL 必须以 ws:// 或 wss:// 开头")
        return self

    def embedding_endpoint(self) -> EmbeddingEndpoint | None:
        """嵌入那一路要打的端点；没开就是没接这一路。

        ⚠ 开关为真时密钥与模型名已经由校验器兜住了（缺一格就启动即失败），
        所以这里不再写一条「没配就降级」的分支——写了反而会让配置漏填悄悄
        变成「服务起着但从来没建过索引」。
        """
        key = self.embedding_api_key
        if not self.embedding_enabled or key is None:
            return None
        return EmbeddingEndpoint(
            base_url=self.embedding_base_url,
            api_key=key,
            model=self.embedding_model,
            timeout_s=self.embedding_timeout_s,
            dimensions=self.embedding_dimensions,
        )

    def chat_endpoint(self) -> ChatEndpoint | None:
        """agentic 检索策略要打的对话端点；没开就是没接这一路。

        ⚠ 没接时那个策略**如实不可用**，不悄悄退化成 naive——悄悄退化的表现是
        「质量忽然变差了」，而没有任何一处报错（ADR-0035 决策二）。
        """
        key = self.model_api_key
        if not self.model_enabled or key is None:
            return None
        return ChatEndpoint(
            base_url=self.model_base_url,
            api_key=key,
            model=self.model_chat,
            timeout_s=self.model_timeout_s,
        )

    @property
    def is_worker(self) -> bool:
        """这个进程跑的是 worker 角色吗。"""
        return self.app_role == ROLE_WORKER
