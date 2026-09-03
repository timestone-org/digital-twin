"""knowledge-server 的配置。继承 lib 的基类，只加本服务字段。

变量名 = `KNOWLEDGE_<组>_<键>`。密钥类一律无默认值——缺失即拒绝启动。
"""

from typing import Self

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

# 向量维数的缺省值。⚠ 它同时是**库上那一列的维数**（`vector(N)` 的 N，建表时
# 定死）与环境变量那一路嵌入端点的维数：两处必须是同一个数，所以只有一个常量
DEFAULT_EMBEDDING_DIMENSIONS = 1536

# 嵌入端点窗口的缺省值。⚠ 切块上限由它折算而来，**不是**切块层自己的常量：
# 端点对超出窗口的那一截静默截断、不报错，配大了只表现为「这一段明明有，
# 就是搜不到」。512 是 bge 系列这类 BERT 底座的常见窗口
DEFAULT_EMBEDDING_MAX_INPUT_TOKENS = 512
# 一块至少多少 token。⚠ 攒不够就跨标题继续攒：只有一行标题的块又短又泛，
# 与任何查询都有中等相似度，专挤名次
DEFAULT_CHUNK_MIN_TOKENS = 80
# 相邻块的重叠字符数。⚠ 不能是 0：跨过一刀的问题两边都答不出，
# 而它看起来只是「这个问题模型不会」
DEFAULT_CHUNK_OVERLAP_CHARS = 120
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
    # 建 `vector(N)` 的那个 N。⚠ 破例进这一份「只连库」的配置：迁移拿不到它
    # 就只能把维数写死在迁移文件里，而维数是部署的取值不是代码的行为
    embedding_dimensions: int = DEFAULT_EMBEDDING_DIMENSIONS


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
    # 模型目录（ADR-0039）：从 platform 的内部面拉「各用途走哪一路模型」，
    # 拿 `edge_service_key` 认证。⚠ 下面嵌入档与对话档那两组环境变量是它的
    # **永久默认值**：目录里没给某个用途分配时才用环境变量那一档，不是一次性
    # 播种（config-and-secrets §7.1）。多久重拉一次；拉不到就沿用上一份
    llm_catalog_refresh_s: float = Field(default=10.0, gt=0)
    # ⚠ 要比 platform 那条短：它与 platform 调用同一档，且在模型调用之前
    llm_catalog_timeout_s: float = Field(default=3.0, gt=0)
    # 向 platform 领订阅账号登录态那一跳的预算（ADR-0041）。⚠ 它在**每一次
    # 模型调用之前**，且平台那一侧可能要先去换一份新的（上游那一跳有 10 秒
    # 硬超时），故比目录那条宽一点；仍要小于模型调用自己的预算
    llm_login_timeout_s: float = Field(default=15.0, gt=0)

    # 嵌入档的**永久默认值**：模型目录里没给「知识库嵌入」分配时用这一组。
    # ⚠ 两处都没有就摄取不了任何文档——向量是检索的必经一路（ADR-0045），
    # 而那时每一份文档会以一句点得出名字的话判失败，不是悄悄走到 ready
    embedding_enabled: bool = False
    embedding_base_url: str = ""
    embedding_api_key: SecretStr | None = None
    embedding_model: str = ""
    embedding_dimensions: int = DEFAULT_EMBEDDING_DIMENSIONS
    # 嵌入端点一次吃得下多少 token。⚠ 切块上限由它折算而来：端点对超出窗口的
    # 那一截**静默截断、不报错**，配大了的表现是「这一段明明有，就是搜不到」。
    # 换嵌入模型要跟着改——它是模型的属性，而 OpenAI 兼容口径里问不出来
    embedding_max_input_tokens: int = Field(
        default=DEFAULT_EMBEDDING_MAX_INPUT_TOKENS, gt=0
    )
    embedding_timeout_s: float = 30.0
    # 切块的下限与重叠。⚠ 上限不在这里：它由上面那格窗口折算而来，
    # 给它单独一格配置就等于允许两者漂开，而漂开的那一侧不报错
    chunk_min_tokens: int = Field(default=DEFAULT_CHUNK_MIN_TOKENS, ge=0)
    chunk_overlap_chars: int = Field(default=DEFAULT_CHUNK_OVERLAP_CHARS, ge=0)
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

    # 重排档（ADR-0042）。⚠ 它**只有模型目录一个来源**，没有环境变量那一档：
    # 这一路是新加的，一个存量部署都不是靠环境变量配着它的，而多一条回退链
    # 就多一处「配了没生效」要排查的地方。
    # ⚠ 预算要比检索那一步的总预算小得多：它排在召回之后，超时就是整次检索超时
    rerank_timeout_s: float = Field(default=15.0, gt=0)

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
    # 外部解析服务（MinerU / PP-Structure 这一类）一次调用最多等多久。
    # ⚠ 与上面那一档分开配：那一路是本地 CPU，这一路是网络 IO，几十秒是常态。
    # 一期没有任何外部后端，这一格因此还没有生效路径（ADR-0043）
    external_parse_timeout_s: float = Field(default=180.0, gt=0)

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
