"""素材表：一个上传件一行，字节在对象存储里，这里只存它的身份与元信息。

⚠ 行在 **finalize 之后**才落：签发凭证不建行。这样就没有「半个素材」这种状态，
也不需要一套清理未完成行的活儿——没搬进正式前缀的字节留在 `staging/`，
由存储侧的生命周期规则回收。
"""

import uuid

from sqlalchemy import BigInteger, CheckConstraint, Index, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin
from platform_server.apps.assets.kinds import ASSET_KINDS
from platform_server.apps.assets.models.base import Base

_KNOWN_KINDS = ", ".join(f"'{kind}'" for kind in ASSET_KINDS)


class Asset(TimestampMixin, Base):
    """一个素材。

    ⚠ 主键由服务端在**签发凭证时**铸好并编进对象键，不是落库时才生成：
    键里那个 id 与行的 id 必须是同一个，否则删素材会删不掉字节。
    """

    __tablename__ = "assets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    # ⚠ 禁原生 ENUM（database-standard §2）：加一类素材要走两次发布，
    # 而 text + CHECK 只改约束
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str] = mapped_column(Text, nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    # 存储端算的 etag，用于「同一份文件重复上传」的提示与完整性核对
    checksum: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=""
    )

    __table_args__ = (
        CheckConstraint(f"kind IN ({_KNOWN_KINDS})", name="assets_kind_known"),
        CheckConstraint("length(name) > 0", name="assets_name_nonempty"),
        CheckConstraint("size_bytes > 0", name="assets_size_positive"),
        # 素材库按类型分页浏览，列表页恒带 kind 过滤
        Index("ix_assets_kind_created_at", "kind", "created_at"),
    )
