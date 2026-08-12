"""OPC UA 服务器实例表。

一行 = 一台逻辑上独立的服务器：一个端点、一段地址空间、一组凭据。
多个实例共处一个进程，端口是它们之间唯一的硬隔离，因此 `port` 唯一。

⚠ 这张表存的是**配置**，不是运行态。实例此刻是否在跑以本地监听端口的实况
为准（CONTEXT §2 不变式 5），`desired_state` 只表达「用户希望它跑」。
"""

from datetime import datetime

from sqlalchemy import (
    ARRAY,
    Boolean,
    CheckConstraint,
    DateTime,
    Integer,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from opcua_server.apps.instance.models.base import Base

# 用户期望的运行状态。实际是否在跑看端口实况，不看这一列。
DESIRED_STATES = ("running", "stopped")

# 与 asyncua 的 `ua.SecurityPolicyType` 成员名逐字一致，运行时直接映射。
# 一期只开前五种，Aes256 两种一并登记以免将来加值又要一次迁移。
SECURITY_POLICIES = (
    "NoSecurity",
    "Basic256Sha256_Sign",
    "Basic256Sha256_SignAndEncrypt",
    "Aes128Sha256RsaOaep_Sign",
    "Aes128Sha256RsaOaep_SignAndEncrypt",
    "Aes256Sha256RsaPss_Sign",
    "Aes256Sha256RsaPss_SignAndEncrypt",
)

PORT_MIN = 1
PORT_MAX = 65535

_POLICY_LITERALS = ", ".join(f"'{policy}'" for policy in SECURITY_POLICIES)
_STATE_LITERALS = ", ".join(f"'{state}'" for state in DESIRED_STATES)


class Instance(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一台 OPC UA 服务器实例的配置。"""

    __tablename__ = "opcua_instances"

    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # `opc.tcp://<host>:<port><endpoint_path>` 的最后一段
    endpoint_path: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'/'")
    )
    # ⚠ 端口来自部署期声明的池；池外端口没有容器映射，实例会「显示运行中
    # 但连不上」。分配与池满判定在 service 层，这里只保证互不重复。
    port: Mapped[int] = mapped_column(Integer, nullable=False)
    namespace_uri: Mapped[str] = mapped_column(Text, nullable=False)
    security_policies: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False
    )
    # 默认禁匿名：上位机必须带 UserName 或 X509 身份
    is_anonymous_allowed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    desired_state: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'stopped'")
    )
    # ⚠ 显式字段，不让前端猜：改了要重启才生效的配置后置真，
    # API 据此回答「本次哪些改动尚未生效」（CONTEXT §6）
    has_pending_restart: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    is_autostart: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    # 证书本体在 OPCUA_PKI_DIR 的挂载卷上；库里只留能在页面展示的指纹与主体
    certificate_fingerprint: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )
    certificate_subject: Mapped[str | None] = mapped_column(Text, nullable=True)
    certificate_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        UniqueConstraint("name", name="uq_opcua_instances_name"),
        UniqueConstraint("port", name="uq_opcua_instances_port"),
        CheckConstraint("length(name) > 0", name="name_nonempty"),
        CheckConstraint(
            "length(namespace_uri) > 0", name="namespace_uri_nonempty"
        ),
        CheckConstraint(
            "endpoint_path LIKE '/%'", name="endpoint_path_absolute"
        ),
        CheckConstraint(
            f"port BETWEEN {PORT_MIN} AND {PORT_MAX}", name="port_in_range"
        ),
        CheckConstraint(
            f"desired_state IN ({_STATE_LITERALS})", name="desired_state_valid"
        ),
        CheckConstraint(
            "cardinality(security_policies) > 0",
            name="security_policies_nonempty",
        ),
        CheckConstraint(
            f"security_policies <@ ARRAY[{_POLICY_LITERALS}]::text[]",
            name="security_policies_known",
        ),
    )
