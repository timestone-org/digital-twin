"""模型凭据表：一路要登录的供应商一行，整套部署共用。

⚠ 认这一行的是 `provider_ref`（目录里那一路供应商的 id），而 `provider` 存的是
**凭据种类**。环境变量配出来的那一路没有目录 id，它的 `provider_ref` 是空的，
读侧于是按 `coalesce(provider_ref, provider)` 认——这也让存量那一行照旧读得到。

⚠ 令牌**只以密文入库**（`token_enc`），明文一个字都不落。旁边那几列
（账号、订阅档、过期时刻）是给界面看的，从令牌里解出来时顺手抄一份——
每次读都去解一遍 JWT 的话，列表页会为了显示一行字解开一把密钥。
"""

import datetime as dt
import uuid

from sqlalchemy import CheckConstraint, DateTime, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ai_assistant.apps.credential.enums import (
    AUTH_MODES,
    PROVIDER_KINDS,
    sql_values,
)
from ai_assistant.apps.credential.models.base import Base
from lib.db import TimestampMixin, UuidPrimaryKeyMixin

PROVIDER_MAX_LENGTH = 32
AUTH_MODE_MAX_LENGTH = 32
ACCOUNT_MAX_LENGTH = 128


class ModelCredential(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一路供应商的登录态。一路只有一行。"""

    __tablename__ = "model_credentials"

    # 凭据种类。⚠ 闭合集合，不是那一路的身份——身份在 `provider_ref`
    provider: Mapped[str] = mapped_column(
        String(PROVIDER_MAX_LENGTH), nullable=False
    )
    # 目录里那一路供应商的 id。⚠ 可空：环境变量配出来的那一路不在目录里，
    # 它那一行靠 `provider` 认。不建外键指向平台的表——跨 schema 外键是三条
    # 禁令之一，何况那张表在另一个服务的属主范围里
    # ⚠ 一路供应商只许有一行；空值互不相撞，故环境变量那一路那几行不受它管
    provider_ref: Mapped[str | None] = mapped_column(
        Text, nullable=True, unique=True
    )
    auth_mode: Mapped[str] = mapped_column(
        String(AUTH_MODE_MAX_LENGTH), nullable=False
    )
    # 令牌包的密文（access / refresh / id 与过期时刻打成一份 JSON 再加密）
    token_enc: Mapped[str] = mapped_column(Text, nullable=False)
    # 给界面看的那几格。⚠ 账号标识只留掩码不留全量：它是 PII，而界面上
    # 要回答的问题只是「现在挂着的是不是我那个号」
    account_label: Mapped[str | None] = mapped_column(
        String(ACCOUNT_MAX_LENGTH), nullable=True
    )
    plan_label: Mapped[str | None] = mapped_column(
        String(ACCOUNT_MAX_LENGTH), nullable=True
    )
    expires_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    last_refresh_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # 谁登录的。⚠ 不建外键指向 auth 的用户表：跨 schema 外键是三条禁令之一
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    # 最近一次刷新失败的原因，给人看。⚠ 不带上游 URL 与令牌片段
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    row_version: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("1")
    )

    __table_args__ = (
        CheckConstraint(
            f"provider IN ({sql_values(PROVIDER_KINDS)})",
            name="provider_known",
        ),
        CheckConstraint(
            f"auth_mode IN ({sql_values(AUTH_MODES)})", name="auth_mode_known"
        ),
        CheckConstraint("row_version >= 1", name="row_version_positive"),
    )
