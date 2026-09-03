"""模型版本的二进制产物：对象键、摘要与训练时的库版本。

⚠ 字节**不在这张表上**，只留一个键：版本列表页要全量读版本表，而一片森林的
产物可以到几十 MB，进库会连着把备份与 WAL 一起撑大
（docs/MODELING_PLATFORM_DESIGN.md D9）。
⚠ 摘要与库版本必须存下来：加载时逐条比对，任何一条不符就拒载而不是硬读
（D10 的护栏 2 与 4）。
"""

import uuid
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    ForeignKeyConstraint,
    Integer,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import UuidPrimaryKeyMixin
from platform_server.apps.modeling.models.base import Base, CreatedAtMixin


class ModelingModelArtifact(UuidPrimaryKeyMixin, CreatedAtMixin, Base):
    """一个模型版本的产物。一个版本至多一份。"""

    __tablename__ = "modeling_model_artifacts"

    model_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )
    # 对象存储里的键。⚠ 由服务端拼，请求里的任何字符串都不进来（护栏 1）
    object_key: Mapped[str] = mapped_column(Text, nullable=False)
    # 内容的 sha256，十六进制。加载前必校
    digest: Mapped[str] = mapped_column(Text, nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    format_version: Mapped[int] = mapped_column(Integer, nullable=False)
    # `{numpy, sklearn}`。与当前进程不一致即拒载
    runtime_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)

    __table_args__ = (
        ForeignKeyConstraint(
            ["model_version_id"],
            ["platform.modeling_model_versions.id"],
            name="fk_modeling_model_artifacts_version_id",
            ondelete="CASCADE",
        ),
        UniqueConstraint(
            "model_version_id", name="uq_modeling_model_artifacts_version"
        ),
        CheckConstraint("length(object_key) > 0", name="object_key_nonempty"),
        # sha256 的十六进制恒为 64 位。⚠ 长度对不上说明写入方换了算法，
        # 而那会让所有存量产物在加载时一起拒载——要在写的那一刻就拦住
        CheckConstraint("length(digest) = 64", name="digest_is_sha256"),
        CheckConstraint("size_bytes > 0", name="size_positive"),
        CheckConstraint("format_version >= 1", name="format_version_valid"),
        CheckConstraint(
            "jsonb_typeof(runtime_json) = 'object'",
            name="runtime_is_an_object",
        ),
    )
