"""ai-assistant 的配置。继承 lib 的基类，只加本服务字段。

变量名 = `ASSISTANT_<组>_<键>`。密钥类一律无默认值——缺失即拒绝启动。
"""

from typing import Self

from pydantic import Field, SecretStr, model_validator
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
    # 一次模型调用的上限。⚠ 它必须大于边缘的读超时才有意义——所以助手的流式
    # 端点不走边缘的通用超时，见 docker/nginx 里那条 location
    model_timeout_s: float = Field(default=120.0, gt=0)
    # 连续失败多少次就断路。断开期间如实回「模型暂时不可用」而不是继续排队等超时
    model_breaker_failures: int = Field(default=5, ge=1)
    model_breaker_reset_s: float = Field(default=30.0, gt=0)

    # platform 的内部面地址。助手是纯消费方，业务数据一律经它拿
    platform_base_url: str = "http://platform-server:8005"
    platform_timeout_s: float = Field(default=5.0, gt=0)

    @model_validator(mode="after")
    def _model_key_required_when_enabled(self) -> Self:
        """开着模型却没配密钥——启动即失败，不留到第一次对话才发现。

        ⚠ 「缺失时打一条 WARN 继续」与「第一次用到时才发现没配」都是明令禁止的
        （config-and-secrets §3）：后者意味着服务已经接了流量，此时失败影响的是
        真实用户。
        """
        if self.model_enabled and self.model_api_key is None:
            raise ValueError(
                "ASSISTANT_MODEL_ENABLED 为真时必须配 ASSISTANT_MODEL_API_KEY"
            )
        return self
