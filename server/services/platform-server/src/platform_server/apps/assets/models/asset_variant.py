"""模型压缩档表：一个模型素材一档一行，记它压到哪一步了。

⚠ 行在 **finalize 那一刻就落齐**（三行 `pending`），不是压完才落：界面要能显示
「正在压」，而「一行都没有」与「压完了但一档都没成」在界面上长得一模一样。

⚠ 不给 `assets` 加一个 JSON 列了事：档位是**会一行行独立变状态**的东西，塞进
JSON 就意味着每改一档都要读—改—写整块，而两个 worker 同时改两档时，后写的那个
会把前一档的结果原样盖回去，且没有任何一处报错。
"""

import uuid

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Index,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin
from platform_server.apps.assets.models.base import Base
from platform_server.apps.assets.variants import MODEL_VARIANTS

#: 一档的生命周期。⚠ text + CHECK 不用原生 ENUM（database-standard §2）
VARIANT_STATUSES = ("pending", "ready", "failed")

_KNOWN_VARIANTS = ", ".join(f"'{name}'" for name in MODEL_VARIANTS)
_KNOWN_STATUSES = ", ".join(f"'{name}'" for name in VARIANT_STATUSES)


class AssetModelVariant(TimestampMixin, Base):
    """一个模型素材的一档压缩产物。"""

    __tablename__ = "asset_model_variants"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    asset_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )
    variant: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default="pending"
    )
    # 未压成时为 NULL：给 0 的话界面会显示「0 B」，那是一个看着像
    # 已经压完的假事实
    size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    checksum: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 失败原因，直接给用户看。压成时清空
    error: Mapped[str] = mapped_column(Text, nullable=False, server_default="")

    __table_args__ = (
        CheckConstraint(
            f"variant IN ({_KNOWN_VARIANTS})",
            name="asset_model_variants_variant_known",
        ),
        CheckConstraint(
            f"status IN ({_KNOWN_STATUSES})",
            name="asset_model_variants_status_known",
        ),
        CheckConstraint(
            "size_bytes IS NULL OR size_bytes > 0",
            name="asset_model_variants_size_positive",
        ),
        # ⚠ 这一对是幂等的落点：队列是 at-least-once，重复投递是常态，
        # 靠它让「再压一遍」写不出第二行
        UniqueConstraint(
            "asset_id", "variant", name="uq_asset_model_variants_asset_variant"
        ),
        Index("ix_asset_model_variants_asset", "asset_id"),
    )
