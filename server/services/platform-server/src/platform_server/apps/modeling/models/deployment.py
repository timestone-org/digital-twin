"""模型对外服务的三张表：部署、API 密钥、调用记录。

「部署」与「绑定」并列而不是替代：绑定是把模型接进系统**内**的台账，部署是把它
开给系统**外**（docs/MODELING_PLATFORM_DESIGN.md D13）。两者都钉一个不可变的
版本，互不依赖。
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Index,
    Integer,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from platform_server.apps.modeling.models.base import Base, CreatedAtMixin

# URL 段的形状。⚠ 与迁移里的 CHECK 必须同一份口径，漂了就是「界面收得下、
# 数据库拒掉」
CODE_PATTERN = r"^[a-z0-9][a-z0-9-]{1,62}$"

# 单次请求的行数上限的上限，以及每分钟调用次数的上限
MAX_ROWS_CEILING = 1000
MAX_RATE_CEILING = 6000


class ModelingDeployment(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一个模型版本对外开出来的服务。"""

    __tablename__ = "modeling_deployments"

    # URL 段。⚠ 不拿版本 id 做 URL：换版本时第三方不必改代码
    code: Mapped[str] = mapped_column(Text, nullable=False)
    model_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # ⚠ 停用后立刻 403，不是静默返回旧值
    is_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True
    )
    max_rows_per_call: Mapped[int] = mapped_column(
        Integer, nullable=False, default=200
    )
    rate_limit_per_minute: Mapped[int] = mapped_column(
        Integer, nullable=False, default=60
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    created_by_name: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        ForeignKeyConstraint(
            ["model_version_id"],
            ["platform.modeling_model_versions.id"],
            name="fk_modeling_deployments_version_id",
            # ⚠ RESTRICT：还有第三方在调的版本删不掉
            ondelete="RESTRICT",
        ),
        UniqueConstraint("code", name="uq_modeling_deployments_code"),
        CheckConstraint(
            f"code ~ '{CODE_PATTERN}'", name="code_is_a_url_segment"
        ),
        CheckConstraint("length(name) > 0", name="name_nonempty"),
        CheckConstraint(
            f"max_rows_per_call BETWEEN 1 AND {MAX_ROWS_CEILING}",
            name="max_rows_in_range",
        ),
        CheckConstraint(
            f"rate_limit_per_minute BETWEEN 1 AND {MAX_RATE_CEILING}",
            name="rate_limit_in_range",
        ),
    )


class ModelingApiKey(UuidPrimaryKeyMixin, CreatedAtMixin, Base):
    """一把开某个部署的密钥。

    ⚠ 一把密钥属于一个部署，不做「一把钥匙开全部部署」：那把撤销的爆炸半径会
    放大到所有对接方。
    ⚠ 明文**不存**：只留 `sha256(明文)` 与前 12 位前缀。明文只在创建回执里出现
    一次——存了就等于给自己留了一个能读出全部密钥的接口。
    """

    __tablename__ = "modeling_api_keys"

    deployment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )
    # 给人看的用途标记（「MES 生产系统」）
    name: Mapped[str] = mapped_column(Text, nullable=False)
    # 明文的前 12 位，**可见**，用于在列表里认出是哪一把
    key_prefix: Mapped[str] = mapped_column(Text, nullable=False)
    # ⚠ 明文是高熵随机串不是口令，不需要慢哈希；比对必须 `compare_digest`
    key_hash: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # ⚠ 异步更新，不进请求事务：每次调用都写一行会把这张表变成热点
    last_used_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    created_by_name: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        ForeignKeyConstraint(
            ["deployment_id"],
            ["platform.modeling_deployments.id"],
            name="fk_modeling_api_keys_deployment_id",
            ondelete="CASCADE",
        ),
        # ⚠ 摘要唯一：校验时按摘要直接查一行，不必遍历这个部署的每一把钥匙
        UniqueConstraint("key_hash", name="uq_modeling_api_keys_hash"),
        CheckConstraint("length(name) > 0", name="name_nonempty"),
        CheckConstraint("length(key_hash) = 64", name="hash_is_sha256"),
        CheckConstraint("length(key_prefix) > 0", name="prefix_nonempty"),
        Index("ix_modeling_api_keys_deployment_id", "deployment_id"),
    )


class ModelingCallLog(UuidPrimaryKeyMixin, CreatedAtMixin, Base):
    """一次对外调用的轻量记录。

    ⚠ **不记入参与出参**：那是业务数据、可能含敏感值，而且体积会压垮这张表。
    排查具体一次调用靠 `trace_id` 去结构化日志里找——日志里同样不记入参。
    """

    __tablename__ = "modeling_call_logs"

    deployment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )
    # ⚠ 可空：密钥被删掉之后这条记录要留着
    api_key_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    row_count: Mapped[int] = mapped_column(Integer, nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    # HTTP 状态码。⚠ 存真实状态码而不是「成功/失败」：限流、鉴权失败与模型
    # 算不出来是三件事，合成一格之后对方问「为什么调不通」就没法答
    status: Mapped[int] = mapped_column(Integer, nullable=False)
    error_code: Mapped[int | None] = mapped_column(Integer, nullable=True)

    __table_args__ = (
        ForeignKeyConstraint(
            ["deployment_id"],
            ["platform.modeling_deployments.id"],
            name="fk_modeling_call_logs_deployment_id",
            ondelete="CASCADE",
        ),
        ForeignKeyConstraint(
            ["api_key_id"],
            ["platform.modeling_api_keys.id"],
            name="fk_modeling_call_logs_api_key_id",
            ondelete="SET NULL",
        ),
        CheckConstraint("row_count >= 0", name="row_count_nonnegative"),
        CheckConstraint("duration_ms >= 0", name="duration_nonnegative"),
        Index(
            "ix_modeling_call_logs_deployment_id_created_at",
            "deployment_id",
            "created_at",
        ),
    )
