"""ai-assistant 的配置。继承 lib 的基类，只加本服务字段。

变量名 = `ASSISTANT_<组>_<键>`。密钥类一律无默认值——缺失即拒绝启动。
"""

import json
from dataclasses import dataclass
from typing import Any, Self, cast

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import SettingsConfigDict

from lib.config import AppSettings, PostgresSettings, RedisSettings

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


def _has_secret(given: SecretStr | None) -> bool:
    """密钥是不是真配了。⚠ 空白与缺席同档。

    Args: given。
    """
    return given is not None and given.get_secret_value().strip() != ""


@dataclass(frozen=True)
class ModelEndpoint:
    """一档模型实际要打的那个端点，回落链已经算完。

    ⚠ 适配器只认这个形状，不再自己去读 `Settings` 的某一格：读格子的话，
    「视觉档回落到对话档」这条链会在每个适配器里各写一遍，而写漏的那一份
    表现为「改了配置没生效」。
    """

    base_url: str
    api_key: SecretStr
    model: str
    timeout_s: float
    extra_body: dict[str, Any] | None


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

    # 第二条模型来路：用 ChatGPT 订阅直连 Codex 后端，而不是按 token 付费的
    # API Key。⚠ 默认关着，且与上面那条**并存**——两边都配好时由会话自己选。
    # ⚠ 这条路走的是未公开接口，供应商随时可能改；它同时要求部署方自己确认
    # 账号与订阅条款允许这么用（上游库自己也把这套标成 experimental）
    codex_enabled: bool = False
    # 走这条路时用哪个模型。⚠ 无默认值：模型代号随供应商发版变，写死一个
    # 我们没验证过的名字，表现是每次对话都撞一条 404，而那与「这一格没填」
    # 看起来毫无关系
    codex_model: str = ""
    # 面板上还能选哪几个，逗号分隔；留空就只有上面那一个
    codex_models: str = ""
    # 推理档位。⚠ 闭合集合，配错了不许起——端点对不认识的档位回 400，
    # 而那条 400 里不会提到是哪一格配错了
    codex_reasoning_effort: str = "medium"
    # 模型账号令牌的加密密钥（Fernet 密钥由它派生）。⚠ 密钥类无默认值；
    # 开了 codex 却没配它 = 启动即失败，见 `_codex_needs_a_credential_secret`
    credential_secret: SecretStr | None = None

    # platform 的内部面地址。助手是纯消费方，业务数据一律经它拿
    platform_base_url: str = "http://platform-server:8005"
    platform_timeout_s: float = Field(default=5.0, gt=0)

    def codex_model_choices(self) -> tuple[str, ...]:
        """面板上可选的模型代号，第一个是默认。"""
        listed = [one.strip() for one in self.codex_models.split(",")]
        names = [self.codex_model, *listed]
        # 去重且保序：写重了只是配置手滑，不该让下拉里出现两个一样的
        return tuple(dict.fromkeys(one for one in names if one))

    def extra_body(self) -> dict[str, Any] | None:
        """透传给端点的额外请求体；没配就是 `None`。"""
        return _parsed_object(self.model_extra_body)

    def endpoint_of(self, kind: str) -> "ModelEndpoint | None":
        """这一档实际要打的那个端点；没开模型或没配密钥时给 `None`。

        ⚠ **回落链在这里逐格写全**，不靠「两档默认值恰好相同」。写不全的表现是
        非对称失效：改了对话档的 base_url，看图那一档还在打旧地址，而两边都
        不报错（config-and-secrets §4）。

        ⚠ 密钥回落的是**对话档那一把**，不是空串：弱默认的密钥等于没有密钥。

        Args: kind（`chat` 或 `vision`；别的一律按对话档）。
        """
        key = self.model_api_key
        if not self.model_enabled or not _has_secret(key) or key is None:
            return None
        if kind != "vision":
            return ModelEndpoint(
                base_url=self.model_base_url,
                api_key=key,
                model=self.model_chat,
                timeout_s=self.model_timeout_s,
                extra_body=self.extra_body(),
            )
        return ModelEndpoint(
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

    @model_validator(mode="after")
    def _codex_needs_a_model_and_a_secret(self) -> Self:
        """开着 codex 却没配模型代号或加密密钥——启动即失败。

        ⚠ 两样都留到第一次用才发现的话：没配模型代号是一条 404，
        没配密钥是「登录成功了但令牌存不进去」——两种现象都指不回这里。
        """
        if not self.codex_enabled:
            return self
        if not self.codex_model.strip():
            raise ValueError(
                "ASSISTANT_CODEX_ENABLED 为真时必须配 ASSISTANT_CODEX_MODEL"
            )
        if not _has_secret(self.credential_secret):
            raise ValueError(
                "ASSISTANT_CODEX_ENABLED 为真时必须配 "
                "ASSISTANT_CREDENTIAL_SECRET"
            )
        return self
