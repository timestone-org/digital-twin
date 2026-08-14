"""API 密钥表：第三方系统用的常驻凭据。

⚠ 密钥明文只在签发响应里出现一次，库里只存 argon2id 散列——与口令同一口径。
⚠ 密钥自身**不持有权限码**，权限全部继承 `user_id` 指向的账号。多一套权限来源
就多一处会漂的真源，而这一处漂掉的后果是「停用了账号但密钥还能写点位」。
⚠ 只吊销不删除：删掉一行等于把这枚密钥的存在本身从审计里抹掉。
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from auth_server.apps.auth.models.base import Base
from lib.db import TimestampMixin, UuidPrimaryKeyMixin

# 明文形如 `dtk_<prefix>_<secret>`。前缀入库、可展示，密钥体只留散列
KEY_TAG = "dtk"
PREFIX_LENGTH = 8
NAME_MAX_LENGTH = 64


class ApiKey(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一枚常驻凭据。"""

    __tablename__ = "auth_api_keys"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        # CASCADE：账号没了，它的密钥必须跟着消失。留着的话，一枚指向空账号的
        # 密钥会在认证时走到「令牌对应的账号不存在」，而它本该压根不存在
        ForeignKey("auth.auth_users.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    prefix: Mapped[str] = mapped_column(Text, nullable=False)
    hashed_secret: Mapped[str] = mapped_column(Text, nullable=False)
    # 空表示永不过期。这必须是调用方主动写出来的选择，不是缺省值
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # 运维的眼睛：没人用的该吊销，被盗的会在这里露出异常活动
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # 签发者。账号被删后记录仍要留存，故与审计表同样不设外键
    issued_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )

    __table_args__ = (
        # 前缀是认证时的查表键，撞一个就等于两枚密钥抢同一行
        UniqueConstraint("prefix", name="uq_auth_api_keys_prefix"),
        Index("ix_auth_api_keys_user_id", "user_id"),
        CheckConstraint("length(name) > 0", name="name_nonempty"),
        CheckConstraint("length(prefix) > 0", name="prefix_nonempty"),
    )

    def is_usable(self, now: datetime) -> bool:
        """此刻能否用于认证：未吊销且未过期。

        Args: now。
        """
        if self.revoked_at is not None:
            return False
        return self.expires_at is None or self.expires_at > now
