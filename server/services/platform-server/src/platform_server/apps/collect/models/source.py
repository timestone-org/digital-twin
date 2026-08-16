"""数据源表：一个可连接的现场端点（协议 + 地址 + 凭据）。"""

from typing import Any

from sqlalchemy import Boolean, CheckConstraint, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from platform_server.apps.collect.models.base import EMPTY_JSON, Base
from platform_server.apps.collect.protocols import (
    PROTOCOLS,
    READ_MODES,
    sql_values,
)

# 采样与轮询周期的下限：比它更密的采样在工控网上只会堆包
MIN_INTERVAL_MS = 50


class CollectSource(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一个数据源。`code` 全局唯一，供人和 Agent 按名字指认。"""

    __tablename__ = "collect_sources"

    name: Mapped[str] = mapped_column(Text, nullable=False)
    code: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    # 备注用途，可空；不参与任何身份或计划比对
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    protocol: Mapped[str] = mapped_column(Text, nullable=False)
    endpoint: Mapped[str] = mapped_column(Text, nullable=False)
    # 连接现场设备的账号名。⚠ 与口令分列：账号名要回显在界面上，口令绝不回
    username: Mapped[str | None] = mapped_column(Text, nullable=True)
    # ⚠ 凭据密文列。明文口令绝不进这张表，也绝不出现在任何出参里
    credential_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 协议特有连接参数，对采集计划的加载与比对不透明
    options_json: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=EMPTY_JSON
    )
    read_mode: Mapped[str] = mapped_column(Text, nullable=False)
    poll_interval_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)

    __table_args__ = (
        CheckConstraint(
            f"protocol IN ({sql_values(PROTOCOLS)})", name="protocol_known"
        ),
        CheckConstraint(
            f"read_mode IN ({sql_values(READ_MODES)})", name="read_mode_known"
        ),
        CheckConstraint("length(name) > 0", name="name_nonempty"),
        CheckConstraint("length(endpoint) > 0", name="endpoint_nonempty"),
        CheckConstraint("length(code) BETWEEN 1 AND 64", name="code_sized"),
        CheckConstraint(
            f"poll_interval_ms >= {MIN_INTERVAL_MS}",
            name="poll_interval_sane",
        ),
    )
