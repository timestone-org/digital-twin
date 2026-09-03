"""ai-assistant 的配置。继承 lib 的基类，只加本服务字段。

变量名 = `ASSISTANT_<组>_<键>`。密钥类一律无默认值——缺失即拒绝启动。
"""

import json
from typing import Any, Self, cast

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import SettingsConfigDict

from lib.config import AppSettings, PostgresSettings, RedisSettings
from llmcore import ChatEndpoint, EmbeddingEndpoint

SERVICE_NAME = "ai-assistant"
API_PREFIX = "/api/v1/assistant"
INTERNAL_PREFIX = "/internal/v1/assistant"
DB_SCHEMA = "assistant"
HTTP_PORT = 8006

# 一个回合最多走几步。到顶就停下并如实告诉用户，而不是继续烧钱：模型绕进死循环
# 时每一步看起来都合理，只有总步数能拦住它
MAX_STEPS_PER_TURN = 24
# 一次对话最多带多少条历史消息进模型。再多就该由编排层摘要——摘要是编排层的事
MAX_HISTORY_MESSAGES = 40
# 超过上面那条线之后，窗口一次脱落这么多，且**脱落点在两次脱落之间原地不动**。
# ⚠ 不这样的话窗口每多一条消息就整体前移一格，历史区的前缀每一轮都对不上，
# 于是过了高水位的会话再也吃不到端点的前缀缓存
HISTORY_DROP_STEP = 10
# 单次服务端工具产出进上下文的字符上限。⚠ 有上限：一次超大结果能把工作面
# 快照与技能正文整个挤掉，而挤掉了哪一段从外面完全看不出来
MAX_TOOL_RESULT_CHARS = 20_000
# 一张截图 base64 之后的字符数上限，约合 3 MB 原图。⚠ 有上限：一张没缩过的整屏
# PNG 能有十几兆，而那时倒下的不只是这一个请求
MAX_IMAGE_CHARS = 4_000_000
# 推理档位的闭合集合
REASONING_EFFORTS = ("low", "medium", "high", "xhigh")


def _parsed_object(given: str) -> dict[str, Any] | None:
    """把一段 JSON 解成对象；空的、或者不是对象，都给 `None`。

    Args: given。
    """
    text = given.strip()
    if not text:
        return None
    try:
        body: object = json.loads(text)
    except ValueError:
        return None
    if not isinstance(body, dict):
        return None
    # ⚠ 收窄一次而不是原样返回：`isinstance` 从 `object` narrow 出来的是
    # `dict[Unknown, Unknown]`，直接返回会把未知类型一路带进装配层
    return cast("dict[str, Any]", body)


def _parsed_list(given: str) -> list[object] | None:
    """把一段 JSON 解成列表；空的、或者不是列表，都给 `None`。

    Args: given。
    """
    text = given.strip()
    if not text:
        return None
    try:
        body: object = json.loads(text)
    except ValueError:
        return None
    return cast("list[object]", body) if isinstance(body, list) else None


def _parsed_names(given: str) -> list[str] | None:
    """一段 JSON 字符串列表；不成形给 `None`，没配给空表。

    Args: given。
    """
    if not given.strip():
        return []
    rows = _parsed_list(given)
    if rows is None or not all(isinstance(one, str) for one in rows):
        return None
    return [one for one in rows if isinstance(one, str)]


def _parsed_servers(given: str) -> list[dict[str, Any]]:
    """一段 MCP server 列表；任一项不成形则整体判空。

    ⚠ **只收 http/https 的 url**：MCP 还有 stdio 传输，而这套部署不接它
    （ADR-0031 决策一）。收下一个 stdio 命令的表现会是「配了却一个工具都没有」。

    Args: given。
    """
    rows = _parsed_list(given)
    if rows is None:
        return []
    found: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            return []
        entry = cast("dict[str, Any]", row)
        name, url = entry.get("name"), entry.get("url")
        if not isinstance(name, str) or not name:
            return []
        if not isinstance(url, str) or not url.startswith(
            ("http://", "https://")
        ):
            return []
        found.append(entry)
    return found


def _has_secret(given: SecretStr | None) -> bool:
    """密钥是不是真配了。⚠ 空白与缺席同档。

    Args: given。
    """
    return given is not None and given.get_secret_value().strip() != ""


class MigrationSettings(PostgresSettings):
    """迁移只需要连库这一组。

    ⚠ 刻意**不**继承完整 `Settings`：跑一次建表与 Redis、模型端点、边缘密钥
    毫无关系，而配置的口径是「缺一个就退出」。让迁移依赖整份配置的后果是——
    任何只配了数据库的场合（CI 的迁移作业、部署时先建表再起服务、本地对着空库
    验可逆性）都会以「Field required」失败，而报出来的字段与建表这件事完全对
    不上号。这条在 opcua-server 上真踩过（#26）。
    """

    model_config = SettingsConfigDict(
        env_prefix="ASSISTANT_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
    )

    postgres_schema: str = DB_SCHEMA


class Settings(AppSettings, PostgresSettings, RedisSettings):
    """进程启动时构造一次并冻结。"""

    model_config = SettingsConfigDict(
        env_prefix="ASSISTANT_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
    )

    app_name: str = SERVICE_NAME
    app_http_port: int = HTTP_PORT
    postgres_schema: str = DB_SCHEMA

    # 知识库读侧。⚠ 留空即这套部署**没接知识库**：那两个工具照样进规格表
    # （理由与长期记忆同源），由 `KnowledgeTools.run` 抛一句点得出名字的错。
    # 不留空但服务没起时是另一回事——那时打过去 502，如实报「暂时不可用」
    knowledge_base_url: str = ""
    knowledge_timeout_s: float = 20.0

    # 边缘注入的身份头由这枚密钥签名，本服务验它、并原样转发给 platform
    edge_signing_secret: SecretStr = Field(min_length=32)
    # 内部端点之间的服务级密钥
    edge_service_key: SecretStr = Field(min_length=32)

    # 模型能力总开关。关着时服务照常起、照常提供会话读取，只是不接模型——
    # 这是「某些现场没有外网」的正解，见 CONTEXT.md §3
    model_enabled: bool = False
    # OpenAI 兼容端点。换供应商只改这一项，代码里不认任何厂商名。
    # ⚠ 缺省给的是 legacy 域名。供应商现在推**业务空间专属域名**，形如
    # `https://{业务空间id}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`——
    # 它含一段只有部署方知道的标识，所以这一项必须是配置而不是常量。
    model_base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    model_api_key: SecretStr | None = None
    # 对话模型与看图模型分两项**不是**因为它们必须不同：当前旗舰原生吃图，
    # 两项给同一个值是常态。分开留着，是为了让「看图那一路换成更便宜的专用
    # 模型」成为一次配置改动而不是一次发版。
    model_chat: str = "qwen3.8-max"
    model_vision: str = "qwen3.8-max"
    # 折叠窗口外那一截用的模型。留空即用 `model_chat`。⚠ 端点与密钥**不单配**：
    # 折叠是后台性质的一次调用，配一整套独立端点的收益抵不上多一条回落链的
    # 代价；真要换供应商时，它跟着对话档走就够了
    summary_model: str = ""

    # 看图那一档的**独立端点**。留空即整格回落到上面对话档那一格——回落链在
    # `endpoint_of` 里逐格写全，不许靠「反正都是同一个默认值」蒙混。
    # ⚠ 存在的理由是「对话走一家、看图走另一家」：两档共用一个 base_url 时，
    # 换看图供应商只能连对话一起换。
    vision_base_url: str = ""
    # ⚠ 密钥类**无默认值**，也不许回落成空串——弱默认的密钥等于没有密钥。
    # 留空时回落的是「用对话档那一把」，而不是「用一个空的」。
    # ⚠ 配了独立端点却不配它 = 拿甲家的密钥打乙家的端点，见
    # `_vision_endpoint_needs_its_own_key`
    vision_api_key: SecretStr | None = None
    # 留空即用 `model_vision`。分出来是为了让「独立端点 + 独立模型名」成立
    vision_model: str = ""
    # 留空（None）即用 `model_timeout_s`。⚠ 看图那一档的延迟本来就高得多，
    # 共用一格意味着要么对话档等得过久、要么视觉档被过早掐断
    vision_timeout_s: float | None = Field(default=None, gt=0)
    vision_extra_body: str = ""
    # 嵌入那一路（ADR-0030）。⚠ 它不是 `ModelKind` 的又一档：返回的是向量不是
    # 对话模型，所以走独立的一组配置与独立的适配器。全留空即本部署没接嵌入——
    # 那时长期记忆仍然记得住（存文本、标没有向量），只是检索用不了
    embedding_base_url: str = ""
    # ⚠ 密钥类无默认值，也不回落成空串。留空时回落「对话档那一把」，
    # 而配了另一家端点却不配它 = 拿甲家密钥打乙家端点，见下面那条校验
    embedding_api_key: SecretStr | None = None
    # 留空即这一路没接。⚠ 没有兜底模型名：嵌入模型与对话模型不通用，
    # 拿对话模型名去打 embeddings 端点是一条必然失败的调用
    embedding_model: str = ""
    # 向量维数。⚠ 落库前拿它核对端点回来的长度：换了嵌入模型而维数变了的话，
    # 旧条目与新条目算不出有意义的余弦，而表现只是「召回忽然变差了」
    embedding_dimensions: int = Field(default=1536, gt=0)
    embedding_timeout_s: float | None = Field(default=None, gt=0)
    # 逐字流式。⚠ 关掉它 = 用户在整个回合里只看得见「做了哪一步」，模型说的
    # 那段话要等回合结束才整段出现，而模型想的十几秒是纯黑箱。留成配置只为
    # 一种场合：个别 OpenAI 兼容端点在带工具时不支持流式，那时表现是一条 400
    model_stream_enabled: bool = True
    # 透传给端点的额外请求体，一段 JSON 对象。⚠ 存在的理由：思考过程一类的
    # 开关在 OpenAI 兼容口径里没有标准字段，各家用自己的键，而代码里不认厂商
    # 名——于是它只能是取值而不是分支。留空即什么都不加。
    # ⚠ 收成 `str` 再自己解，而不是声明成 `dict`：声明成 dict 时
    # `ASSISTANT_MODEL_EXTRA_BODY=`（留空是最常见的「还没填」形态）会在配置源
    # 那一层就炸，报出来的是一句「解析字段失败」，与「这一格可以不填」完全对不上
    model_extra_body: str = ""
    # 一次模型调用的上限。⚠ 它必须大于边缘的读超时才有意义——所以助手的流式
    # 端点不走边缘的通用超时，见 docker/nginx 里那条 location
    model_timeout_s: float = Field(default=120.0, gt=0)
    # 连续失败多少次就断路。断开期间如实回「模型暂时不可用」而不是继续排队等超时
    model_breaker_failures: int = Field(default=5, ge=1)
    model_breaker_reset_s: float = Field(default=30.0, gt=0)

    # 订阅账号那一路（ADR-0026）的推理档位缺省。⚠ 闭合集合，配错了不许起——
    # 端点对不认识的档位回 400，而那条 400 里不会提到是哪一格配错了。
    # ⚠ 这一路**没有环境变量档**：它要先登录一次，而登录态挂在目录里那一路
    # 供应商的行上（ADR-0041）——目录之外配出来的那一路无处存登录态。
    # 那一路配在模型管理页上，这一格只是它没配推理档位时的缺省
    codex_reasoning_effort: str = "medium"

    # platform 的内部面地址。助手是纯消费方，业务数据一律经它拿
    platform_base_url: str = "http://platform-server:8005"
    platform_timeout_s: float = Field(default=5.0, gt=0)
    # 模型目录（ADR-0039）：从 platform 的内部面拉「各用途走哪一路模型」，
    # 拿 `edge_service_key` 认证。⚠ 上面 `ASSISTANT_MODEL_*` 那一组是它的
    # **永久默认值**：目录里没给某个用途分配时才用环境变量那一档，不是一次性
    # 播种（config-and-secrets §7.1）。多久重拉一次；拉不到就沿用上一份
    llm_catalog_refresh_s: float = Field(default=10.0, gt=0)
    # ⚠ 要比 platform 那条短：它与 platform 调用同一档，且在模型调用之前
    llm_catalog_timeout_s: float = Field(default=3.0, gt=0)
    # 向平台领订阅账号登录态那一跳的预算（ADR-0041）。⚠ 它在**每一次模型调用
    # 之前**，且平台那一侧可能要先去换一份新的（上游那一跳有 10 秒硬超时），
    # 故比目录那条宽一点；仍要小于模型调用自己的预算
    llm_login_timeout_s: float = Field(default=15.0, gt=0)

    # auth-server 的内部面地址。只用来给长回合的委托身份续签——边缘签的那组头
    # 只有几十秒，不续的话回合后半段每一次工具调用都是 401
    # （`upstream/identity.py`）
    auth_base_url: str = "http://auth-server:8004"
    # ⚠ 要比 platform 那条短：它是 platform 调用**之前**的一跳，
    # 下游之和必须小于上游（runtime-resilience §3）
    auth_timeout_s: float = Field(default=3.0, gt=0)

    # 外部 MCP server（ADR-0031）。一段 JSON 列表，逐项含
    # `name` / `url` / `is_auth_required`。
    # ⚠ **只认 HTTP 传输**：配一个 stdio 命令进来是配不进的，那一档要每个副本
    # 起子进程，而 api 角色无状态且要水平扩。
    # ⚠ 令牌**不进这一格**、更不进 URL——URL 会进日志、进链路追踪、进错误消息
    mcp_servers: str = ""
    # 各路的令牌，一段 JSON 对象 `{server 名: 令牌}`。⚠ 密钥类无默认值；
    # 某一路 `is_auth_required` 为真却缺它 = 启动即失败，见
    # `_mcp_auth_is_complete`
    mcp_tokens: SecretStr | None = None
    # 许下发的**写操作**规范名，一段 JSON 字符串列表（`["mcp.a.b"]`）。
    # ⚠ 默认空：MCP 的 `readOnlyHint` 是可选的，缺了那一格的工具可能删东西，
    # 所以说不清就当写操作、不下发。放行的代价不可逆，拦下的只是补一行
    mcp_write_allowed: str = ""
    mcp_timeout_s: float = Field(default=10.0, gt=0)
    mcp_breaker_failures: int = Field(default=3, ge=1)
    mcp_breaker_reset_s: float = Field(default=60.0, gt=0)

    def extra_body(self) -> dict[str, Any] | None:
        """透传给端点的额外请求体；没配就是 `None`。"""
        return _parsed_object(self.model_extra_body)

    def endpoint_of(self, kind: str) -> ChatEndpoint | None:
        """这一档实际要打的那个端点；没开模型或没配密钥时给 `None`。

        ⚠ **回落链在这里逐格写全**，不靠「两档默认值恰好相同」。写不全的表现是
        非对称失效：改了对话档的 base_url，看图那一档还在打旧地址，而两边都
        不报错（config-and-secrets §4）。

        ⚠ 密钥回落的是**对话档那一把**，不是空串：弱默认的密钥等于没有密钥。

        Args: kind（`chat` / `vision` / `summary`；别的一律按对话档）。
        """
        key = self.model_api_key
        if not self.model_enabled or not _has_secret(key) or key is None:
            return None
        if kind != "vision":
            return ChatEndpoint(
                base_url=self.model_base_url,
                api_key=key,
                # ⚠ 只有模型名按档分：摘要档共用对话档的端点、密钥与超时，
                # 单配一整套的收益抵不上多一条回落链的代价
                model=(
                    self.summary_model or self.model_chat
                    if kind == "summary"
                    else self.model_chat
                ),
                timeout_s=self.model_timeout_s,
                extra_body=self.extra_body(),
            )
        return ChatEndpoint(
            base_url=self.vision_base_url or self.model_base_url,
            api_key=(
                self.vision_api_key
                if _has_secret(self.vision_api_key)
                and self.vision_api_key is not None
                else key
            ),
            model=self.vision_model or self.model_vision,
            timeout_s=self.vision_timeout_s or self.model_timeout_s,
            extra_body=(
                _parsed_object(self.vision_extra_body) or self.extra_body()
            ),
        )

    def embedding_endpoint(self) -> EmbeddingEndpoint | None:
        """嵌入那一路要打的端点；没配模型名就是没接这一路。

        ⚠ 回落链在这里逐格写全，与 `endpoint_of` 同一条口径。
        ⚠ **模型名没有兜底**：嵌入模型与对话模型不通用，拿对话模型名去打
        embeddings 端点是一条必然失败的调用，而它每次只在 remember 时才炸。
        """
        key = self.model_api_key
        if not self.embedding_model.strip() or not _has_secret(key):
            return None
        own = self.embedding_api_key
        return EmbeddingEndpoint(
            base_url=self.embedding_base_url or self.model_base_url,
            api_key=(
                own if _has_secret(own) and own is not None else key
            ),  # pyright: ignore[reportArgumentType]  # 理由：上一行已判非空
            model=self.embedding_model,
            timeout_s=self.embedding_timeout_s or self.model_timeout_s,
            dimensions=self.embedding_dimensions,
        )

    @model_validator(mode="after")
    def _embedding_endpoint_needs_its_own_key(self) -> Self:
        """嵌入配了**另一家**端点，就必须配它自己的密钥。

        ⚠ 与看图那一条同源：不拦的话，回落会拿对话档那把密钥去打另一家端点，
        每次 remember 都撞 401，而降级路径会把它吞成「这条暂时检索不到」——
        于是现象是「记是记住了，就是永远查不到」，与「这一格没填」毫无关系。
        """
        endpoint = self.embedding_base_url.strip()
        if not endpoint or endpoint == self.model_base_url.strip():
            return self
        if not _has_secret(self.embedding_api_key):
            raise ValueError(
                "配了 ASSISTANT_EMBEDDING_BASE_URL（与对话档不同）时"
                "必须配 ASSISTANT_EMBEDDING_API_KEY"
            )
        return self

    @field_validator("vision_extra_body")
    @classmethod
    def _vision_extra_body_must_be_an_object(cls, given: str) -> str:
        """与对话档同一条口径：配错了就不许起。

        Args: given。
        """
        if given.strip() and _parsed_object(given) is None:
            raise ValueError("ASSISTANT_VISION_EXTRA_BODY 必须是一段 JSON 对象")
        return given

    @model_validator(mode="after")
    def _vision_endpoint_needs_its_own_key(self) -> Self:
        """看图配了**另一家**端点，就必须配它自己的密钥。

        ⚠ 不拦的话，回落会拿对话档那一把密钥去打另一家的端点——每一次看图都
        撞 401，而那一档刻意不打开断路器（是我们配错了，不是下游不行），
        于是每次都要等一个完整往返才失败。现象是「截图功能时好时坏」，
        与「这一格没填」看着毫无关系。
        """
        endpoint = self.vision_base_url.strip()
        if not endpoint or endpoint == self.model_base_url.strip():
            return self
        if not _has_secret(self.vision_api_key):
            raise ValueError(
                "配了 ASSISTANT_VISION_BASE_URL（与对话档不同）时"
                "必须配 ASSISTANT_VISION_API_KEY"
            )
        return self

    def mcp_server_list(self) -> tuple[dict[str, Any], ...]:
        """配了哪几路 MCP；没配就是空。

        ⚠ 回的是原始字典而不是 `McpServer`：配置层不认上游那一层的类型，
        免得两边互相 import。
        """
        return tuple(_parsed_servers(self.mcp_servers))

    def mcp_token_map(self) -> dict[str, str]:
        """各路的令牌；没配就是空表。"""
        if not _has_secret(self.mcp_tokens) or self.mcp_tokens is None:
            return {}
        parsed = _parsed_object(self.mcp_tokens.get_secret_value())
        if parsed is None:
            return {}
        return {
            str(key): str(value)
            for key, value in parsed.items()
            if isinstance(value, str) and value
        }

    def mcp_write_names(self) -> frozenset[str]:
        """许下发的写操作规范名。⚠ 配歪时给空集——校验器已经在启动期拦过一次，
        走到这里还是 `None` 只可能是校验被绕开了，那时空集是安全的一端。"""
        return frozenset(_parsed_names(self.mcp_write_allowed) or ())

    @field_validator("mcp_servers")
    @classmethod
    def _mcp_servers_must_be_a_list(cls, given: str) -> str:
        """配错了就不许起。

        ⚠ 留到第一次对话才发现的话，现象是「MCP 工具一个都没出现」，
        而那与「装不上就如实缺席」长得一模一样——查不出是配歪了。

        Args: given。
        """
        if given.strip() and not _parsed_servers(given):
            raise ValueError(
                "ASSISTANT_MCP_SERVERS 必须是一段 JSON 列表，"
                "逐项含 name 与 url（url 只收 http/https）"
            )
        return given

    @field_validator("mcp_write_allowed")
    @classmethod
    def _mcp_write_allowed_must_be_a_list(cls, given: str) -> str:
        """配错了就不许起。

        Args: given。
        """
        if given.strip() and _parsed_names(given) is None:
            raise ValueError(
                "ASSISTANT_MCP_WRITE_ALLOWED 必须是一段 JSON 字符串列表"
            )
        return given

    @model_validator(mode="after")
    def _mcp_auth_is_complete(self) -> Self:
        """某一路要鉴权却没给它令牌——启动即失败。

        ⚠ 不给 WARN continue：留到运行期的话，那一路每次 `tools/list` 都撞 401、
        断路器打开，现象是「这一路的工具时有时无」，而它指不回这一格。
        """
        tokens = self.mcp_token_map()
        missing = [
            str(one.get("name"))
            for one in self.mcp_server_list()
            if one.get("is_auth_required")
            and not tokens.get(str(one.get("name")))
        ]
        if missing:
            raise ValueError(
                f"这几路 MCP 要鉴权却没在 ASSISTANT_MCP_TOKENS 里配令牌："
                f"{'、'.join(missing)}"
            )
        return self

    @field_validator("model_extra_body")
    @classmethod
    def _extra_body_must_be_an_object(cls, given: str) -> str:
        """配错了就不许起。

        ⚠ 留到第一次对话才发现的话，报出来的是一条模型端点的 400，
        而那与「本地这一格写歪了」看着毫无关系。

        Args: given。
        """
        if given.strip() and _parsed_object(given) is None:
            raise ValueError("ASSISTANT_MODEL_EXTRA_BODY 必须是一段 JSON 对象")
        return given

    @model_validator(mode="after")
    def _model_key_required_when_enabled(self) -> Self:
        """开着模型却没配密钥——启动即失败，不留到第一次对话才发现。

        ⚠ 「缺失时打一条 WARN 继续」与「第一次用到时才发现没配」都是明令禁止的
        （config-and-secrets §3）：后者意味着服务已经接了流量，此时失败影响的是
        真实用户。

        ⚠ **空串也算没配。** 环境变量留空是最常见的「还没填」形态——
        `.env` 里写着 `ASSISTANT_MODEL_API_KEY=` 就是它。只判 `is None` 的话，
        空串会一路过关，服务照常起、能力面照常说「接了模型」，而每一次对话都
        撞 401；那一档还刻意不打开断路器（是我们配错了，不是下游不行），
        于是每次都要等一个完整的往返才失败。
        """
        if self.model_enabled and not _has_secret(self.model_api_key):
            raise ValueError(
                "ASSISTANT_MODEL_ENABLED 为真时必须配 ASSISTANT_MODEL_API_KEY"
            )
        return self

    @field_validator("codex_reasoning_effort")
    @classmethod
    def _effort_must_be_known(cls, given: str) -> str:
        """推理档位是闭合集合，配错了不许起。

        ⚠ 留到第一次对话才发现的话，报出来的是端点的一条 400，
        而那条 400 里不会提到是哪一格配错了。

        Args: given。
        """
        if given not in REASONING_EFFORTS:
            allowed = "/".join(REASONING_EFFORTS)
            raise ValueError(
                f"ASSISTANT_CODEX_REASONING_EFFORT 只能是 {allowed}"
            )
        return given
