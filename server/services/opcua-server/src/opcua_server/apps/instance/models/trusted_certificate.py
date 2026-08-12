"""客户端证书白名单：X509 身份令牌按指纹放行。

公钥可以进库——公钥不是秘密。**私钥绝不进库**（不变式 7）：它只在
`OPCUA_PKI_DIR` 的挂载卷上，进库会随数据库备份跑到任何存备份的地方，
而那时「私钥不进版本库」这条约束已经从侧面破了。
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

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from opcua_server.apps.instance.models.base import Base


class TrustedCertificate(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一张被某个实例信任的客户端证书。"""

    __tablename__ = "opcua_instance_trusted_certs"

    instance_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("opcua.opcua_instances.id", ondelete="CASCADE"),
        nullable=False,
    )
    # SHA-256 指纹的十六进制串，实例内唯一——它就是这张证书的身份
    fingerprint: Mapped[str] = mapped_column(Text, nullable=False)
    subject: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    # PEM 公钥。留在库里是为了实例启动时不必再去卷上找散落的文件
    public_key_pem: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint(
            "instance_id",
            "fingerprint",
            name="uq_opcua_instance_trusted_certs_instance_id_fingerprint",
        ),
        CheckConstraint("length(fingerprint) > 0", name="fingerprint_nonempty"),
        CheckConstraint("length(subject) > 0", name="subject_nonempty"),
        # 私钥进库是设计错误，这条把最常见的粘贴形态挡在写入之前。
        # ⚠ 约束名要短：PG 的标识符上限 63 字符，超了会被截断成带哈希的名字，
        # 不同环境可能不同，将来的迁移就引用不到它了。
        CheckConstraint(
            "public_key_pem IS NULL OR public_key_pem NOT LIKE '%PRIVATE KEY%'",
            name="no_private_key",
        ),
        Index("ix_opcua_instance_trusted_certs_instance_id", "instance_id"),
    )
