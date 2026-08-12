"""实例面的入参与出参。

⚠ `is_running` 与 `desired_state` 是两件事：前者来自本地监听端口的实况，
后者只是用户按下过启动还是停止（CONTEXT.md §2 不变式 5）。两个都出，是为了让
「我明明启动了它却连不上」在页面上一眼可见，而不是被一个字段糊住。
"""

import uuid
from typing import Annotated, Literal

from pydantic import Field, StringConstraints

from opcua_server.apps.instance.schemas.common import (
    InputModel,
    OutputModel,
    Utc,
)

InstanceName = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=64,
        pattern=r"^[A-Za-z][A-Za-z0-9_-]*$",
    ),
]
EndpointPath = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, min_length=1, max_length=128, pattern=r"^/.*$"
    ),
]
NamespaceUri = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)
]
Description = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=255)
]

# ⚠ 逐字重复模型里的 SECURITY_POLICIES / DESIRED_STATES，而不是从常量推导：
# `Literal[<变量>]` 过不了 pyright，而本仓不收裸 `type: ignore`。
# 两处一致由契约测试 test_api_contract.py 钉死，漂移即红灯。
SecurityPolicy = Literal[
    "NoSecurity",
    "Basic256Sha256_Sign",
    "Basic256Sha256_SignAndEncrypt",
    "Aes128Sha256RsaOaep_Sign",
    "Aes128Sha256RsaOaep_SignAndEncrypt",
    "Aes256Sha256RsaPss_Sign",
    "Aes256Sha256RsaPss_SignAndEncrypt",
]


class CertificateOut(OutputModel):
    """证书的可展示部分。⚠ 私钥不在这里，也不在库里——它只在挂载卷上。"""

    fingerprint: str | None = None
    subject: str | None = None
    expires_at: Utc | None = None


class InstanceOut(OutputModel):
    """实例详情。"""

    id: uuid.UUID
    name: str
    description: str | None = None
    endpoint_path: str
    port: int
    namespace_uri: str
    security_policies: list[str]
    is_anonymous_allowed: bool
    is_autostart: bool
    # 用户希望它跑还是停
    desired_state: str
    # ⚠ 真的连了一次本地端口才给 true，不是读上面那个字段
    is_running: bool
    # 已保存但要重启才生效的改动存在与否
    has_pending_restart: bool
    # 尚未生效的字段名，空数组表示全部已生效
    pending_fields: list[str] = Field(default_factory=list[str])
    endpoint_url: str
    node_count: int
    session_count: int
    certificate: CertificateOut
    created_at: Utc
    updated_at: Utc


class InstanceCreateIn(InputModel):
    """建实例。端口不由调用方指定——它从部署期声明的池里分配。"""

    name: InstanceName
    description: Description | None = None
    namespace_uri: NamespaceUri
    endpoint_path: EndpointPath = "/digitaltwin"
    security_policies: list[SecurityPolicy] = Field(min_length=1)
    is_anonymous_allowed: bool = False
    is_autostart: bool = False


class InstanceUpdateIn(InputModel):
    """改实例配置。缺省的字段表示本次不涉及。

    ⚠ 除 `description` 与 `is_autostart` 外，其余每一项都要重启才生效。
    响应里的 `pending_fields` 会逐项列出，接口不会假装已经生效。
    """

    description: Description | None = None
    namespace_uri: NamespaceUri | None = None
    endpoint_path: EndpointPath | None = None
    security_policies: list[SecurityPolicy] | None = Field(
        default=None, min_length=1
    )
    is_anonymous_allowed: bool | None = None
    is_autostart: bool | None = None


class InstanceActionOut(OutputModel):
    """起停结果。以实况为准，不回显期望值。"""

    id: uuid.UUID
    is_running: bool
    desired_state: str
    endpoint_url: str


class PortPoolOut(OutputModel):
    """端口池的占用情况。池满时创建实例被拒绝，不会挑池外端口顶上。"""

    total: int
    used: int
    available: int
    max_instances: int
    instance_count: int
