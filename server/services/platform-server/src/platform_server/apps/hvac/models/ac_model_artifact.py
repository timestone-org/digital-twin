"""模型工件表：训练产物的字节与加载护栏所需的版本信息。"""

import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Integer, LargeBinary, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin
from platform_server.apps.hvac.models.base import Base


class AcModelArtifact(TimestampMixin, Base):
    """一个模型的封存工件。

    单独一张表：列表页查模型不该把几百 KB 的字节拖出来。存库不落盘——每个
    副本都要能加载（docs/AC_MODEL_DESIGN.md §3.2）。
    """

    __tablename__ = "hvac_ac_model_artifacts"

    model_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("platform.hvac_ac_models.id", ondelete="CASCADE"),
        primary_key=True,
    )
    payload: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    # SHA-256，加载前比对；防存储损坏与手改库，不防拿到 DB 写权限的攻击者
    digest: Mapped[str] = mapped_column(Text, nullable=False)
    format_version: Mapped[int] = mapped_column(Integer, nullable=False)
    sklearn_version: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        CheckConstraint("length(digest) = 64", name="digest_sized"),
        CheckConstraint("format_version >= 1", name="format_version_positive"),
    )
