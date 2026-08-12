"""上位机身份面的入参与出参：会话、凭据、信任证书。

⚠ 这一层的「用户」是**上位机**，不是平台的人类用户（CONTEXT.md §7）。
两个账号池完全分离：上位机账号不该能登录 Web，人类用户也不该把登录口令
填进某台 SCADA 的连接配置里。
"""

import uuid
from typing import Annotated

from pydantic import StringConstraints

from opcua_server.apps.instance.schemas.common import (
    InputModel,
    OutputModel,
    Trimmed,
    Utc,
)

Username = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=64,
        pattern=r"^[A-Za-z0-9._-]+$",
    ),
]
# ⚠ 不开 strip_whitespace：口令被静默去空白等于悄悄改了凭据
Password = Annotated[str, StringConstraints(min_length=12, max_length=128)]


class SessionOut(OutputModel):
    """一条在线的上位机会话。"""

    session_id: str
    peer: str
    username: str | None = None
    connected_at: Utc


class CredentialOut(OutputModel):
    """实例凭据。⚠ 明文口令永远不在这里——它只在创建时返回一次。"""

    id: uuid.UUID
    instance_id: uuid.UUID
    username: str
    created_at: Utc


class CredentialCreatedOut(OutputModel):
    """刚建成的凭据。`password` 是**唯一一次**能拿到明文的地方。

    ⚠ 丢了只能重建，不能找回：库里存的是散列。
    """

    credential: CredentialOut
    password: str


class CredentialCreateIn(InputModel):
    """建实例凭据。不填口令则由服务端生成一个高强度随机口令。"""

    username: Username
    password: Password | None = None


class TrustedCertificateOut(OutputModel):
    """一张被信任的客户端证书。公钥不是秘密，故可入库。"""

    id: uuid.UUID
    instance_id: uuid.UUID
    fingerprint: str
    subject: str
    expires_at: Utc | None = None
    created_at: Utc


class TrustedCertificateCreateIn(InputModel):
    """登记客户端证书。

    ⚠ 只收 PEM 公钥。带私钥的输入一律拒绝——库里出现私钥意味着它会随
    数据库备份跑到任何存备份的地方（不变式 7）。
    """

    certificate_pem: Trimmed
