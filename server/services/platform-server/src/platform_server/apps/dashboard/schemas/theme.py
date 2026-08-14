"""项目自定义主题的入参与出参。"""

import uuid
from typing import Any, ClassVar, Literal

from pydantic import Field

from platform_server.apps.dashboard.schemas.common import (
    InputModel,
    Label,
    OutputModel,
    UpdateModel,
)

# 明暗两档，前端据它决定用哪套内置底色兜底。⚠ 字面量不是数字：数字枚举
# 在两个仓之间对不上号时没有任何提示（api-contract §4.2）
ThemeMode = Literal["dark", "light"]
THEME_MODES: tuple[str, ...] = ("dark", "light")


class ThemeOut(OutputModel):
    """一套项目自定义主题。

    ⚠ `tokens` 对服务端是**不透明**的：token 词表归前端的 `@dt/tokens`，
    服务端只负责原样存取。在这里把词表再声明一遍的代价是，前端每加一个
    token 都要跟一次后端发版，而后端对它一个字也用不上。
    """

    id: uuid.UUID
    name: str
    mode: ThemeMode
    tokens: dict[str, Any]


class ThemeCreateIn(InputModel):
    """新建一套自定义主题。id 由服务端发，同项目内主题名不唯一。"""

    name: Label
    mode: ThemeMode
    tokens: dict[str, Any] = Field(default_factory=dict[str, Any])


class ThemeUpdateIn(UpdateModel):
    """改一套自定义主题。缺省的字段表示本次不涉及。"""

    NON_NULLABLE: ClassVar[frozenset[str]] = frozenset(
        {"name", "mode", "tokens"}
    )

    name: Label | None = None
    mode: ThemeMode | None = None
    tokens: dict[str, Any] | None = None
