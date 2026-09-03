"""订阅账号的登录态：要登录的那一路供应商一行，整套部署共用（ADR-0041）。

⚠ 与供应商那一行**同属主**：登录态是「这一路怎么接」的一部分，两个消费方
（助手、知识库）都要它。凭据只能有一个属主，否则同一个账号要在每个消费方
那儿各登一遍。

⚠ 令牌**只以密文入库**（`token_enc`），明文一个字都不落。旁边那几列
（账号、订阅档、过期时刻）是给界面看的，从令牌里解出来时顺手抄一份——
每次读都去解一遍 JWT 的话，列表页会为了显示一行字解开一把密钥。
"""

import datetime as dt
import uuid

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from platform_server.apps.llm_providers.enums import AUTH_MODES, sql_values
from platform_server.apps.llm_providers.models.base import Base
from platform_server.apps.llm_providers.models.provider import LlmProvider

AUTH_MODE_MAX_LENGTH = 32
ACCOUNT_MAX_LENGTH = 128


class LlmProviderCredential(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一路供应商的登录态。一路只有一行。"""

    __tablename__ = "llm_provider_credentials"

    # 挂在哪一路上。⚠ 唯一 + 级联删：这一行是那一路的一部分，供应商删了它
    # 也就没有意义了；留着的话，下一个建出来的供应商可能撞上一行没人认领的
    # 登录态
    provider_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey(LlmProvider.id, ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    # 认证方式。⚠ 闭合集合，用 CHECK 不用原生 ENUM
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
    # 谁登录的。⚠ 存字符串不存 UUID：不建外键指向 auth 的用户表，跨 schema
    # 外键是三条禁令之一
    updated_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 最近一次续期失败的原因，给人看。⚠ 不带上游 URL 与令牌片段
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    row_version: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("1")
    )

    __table_args__ = (
        CheckConstraint(
            f"auth_mode IN ({sql_values(AUTH_MODES)})", name="auth_mode_known"
        ),
        CheckConstraint("row_version >= 1", name="row_version_positive"),
    )
