"""卡片样式表：一整套观感存成一等资源，全站共享，可套回任意同类型节点。

一条样式分两段：外壳（`chrome_json`，键出自模块清单的 `chrome_keys`）与内芯
（`config_json`，某个模块自己的观感键）。`module_type` 为空即通用外壳样式，
套到任何模块上都只写外壳。

⚠ `module_type` **不建外键也不建原生 ENUM**：模块表的真源是前端构建期产物
（`module_types.json`），库里没有可指的表，而原生 ENUM 是数据库规范的硬禁项。
未注册的类型由服务层按目录校验。
⚠ **不建** `(module_type, name)` 唯一键：同名两条样式是用户自己的事，唯一键会
让「另存为」在重名时抛 409，而那一刻他要的正是「再存一条」。
"""

from typing import Any

from sqlalchemy import CheckConstraint, Index, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from lib.db import TimestampMixin, UuidPrimaryKeyMixin
from platform_server.apps.dashboard.models.base import EMPTY_JSON, Base


class CardStyle(UuidPrimaryKeyMixin, TimestampMixin, Base):
    """一条卡片样式。外壳一袋、内芯一袋，两袋都是自由 JSON。"""

    __tablename__ = "card_styles"

    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 空 = 通用外壳样式，不绑任何模块
    module_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    chrome_json: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=EMPTY_JSON
    )
    config_json: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=EMPTY_JSON
    )
    # 缩略图 data URL，存样式时从预览区截一张
    thumbnail: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        CheckConstraint("length(name) > 0", name="name_nonempty"),
        CheckConstraint(
            "module_type IS NULL OR length(module_type) > 0",
            name="module_type_nonempty",
        ),
        # ⚠ 这一条在**库里**守，不只在服务层：内芯键是逐模块的，库里躺着一条
        # 带内芯的通用样式，套用时那半袋静默不生效，是查起来最费劲的那种
        CheckConstraint(
            "module_type IS NOT NULL OR config_json = '{}'::jsonb",
            name="generic_style_carries_no_config",
        ),
        Index("ix_card_styles_module_type", "module_type"),
    )
