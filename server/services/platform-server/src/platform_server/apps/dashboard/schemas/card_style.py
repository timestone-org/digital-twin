"""卡片样式库的入参与出参。

⚠ 列表项**带两袋 JSON**：一条样式撑死几 KB，而样式墙上每一格都要照着它渲染
一张预览，分两次拉只换来一次多余往返（与整屏模板刻意相反，那边一份包几百 KB）。

⚠ 改样式**收不了 `module_type`**：内芯键是逐模块的，换了类型整段内芯当场作废，
而库里那袋值不会跟着消失——它会一直躺着、套用时静默不生效。要换类型就复制一条。
"""

import uuid
from typing import Any, ClassVar

from pydantic import Field

from platform_server.apps.dashboard.schemas.common import (
    InputModel,
    Label,
    ModuleType,
    OutputModel,
    UpdateModel,
    Utc,
)
from platform_server.apps.dashboard.schemas.transfer import (
    MAX_DESCRIPTION_LENGTH,
)


class CardStyleOut(OutputModel):
    """一条卡片样式的完整取值。"""

    id: uuid.UUID
    name: str
    description: str | None
    # 空 = 通用外壳样式：只写外壳，套到任何模块上都成立
    module_type: str | None
    chrome_json: dict[str, Any]
    config_json: dict[str, Any]
    thumbnail: str | None
    created_at: Utc
    updated_at: Utc


class CardStyleCreateIn(InputModel):
    """存一条样式。`module_type` 留空即通用外壳样式。"""

    name: Label
    description: str | None = Field(
        default=None, max_length=MAX_DESCRIPTION_LENGTH
    )
    module_type: ModuleType | None = None
    chrome_json: dict[str, Any] = Field(default_factory=dict[str, Any])
    config_json: dict[str, Any] = Field(default_factory=dict[str, Any])
    thumbnail: str | None = None


class CardStyleUpdateIn(UpdateModel):
    """改一条样式。缺省的字段表示本次不涉及。"""

    NON_NULLABLE: ClassVar[frozenset[str]] = frozenset(
        {"name", "chrome_json", "config_json"}
    )

    name: Label | None = None
    description: str | None = Field(
        default=None, max_length=MAX_DESCRIPTION_LENGTH
    )
    chrome_json: dict[str, Any] | None = None
    config_json: dict[str, Any] | None = None
    thumbnail: str | None = None
