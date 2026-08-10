"""路由规则面的入参与出参。"""

import uuid
from typing import Annotated, Literal

from pydantic import Field, StringConstraints

from auth_server.apps.auth.schemas.common import (
    InputModel,
    OutputModel,
    Trimmed,
    Utc,
)

MatchMode = Literal["all", "any"]
HttpMethod = Literal[
    "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "*"
]

PathPattern = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, min_length=1, max_length=255, pattern=r"^/"
    ),
]


class RouteRuleOut(OutputModel):
    """一条鉴权矩阵规则。"""

    id: uuid.UUID
    path_pattern: str
    http_method: HttpMethod
    permission_codes: list[str]
    match_mode: MatchMode
    priority: int
    is_enabled: bool
    is_builtin: bool
    description: str | None = None
    created_at: Utc
    updated_at: Utc


class RouteRuleCreateIn(InputModel):
    """新增规则。⚠ 空 `permission_codes` = 任意已登录用户放行，不是匿名放行。"""

    path_pattern: PathPattern
    http_method: HttpMethod
    permission_codes: list[Trimmed] = Field(
        default_factory=list[str], max_length=50
    )
    match_mode: MatchMode = "all"
    priority: int = Field(default=0, ge=0, le=999)
    is_enabled: bool = True
    description: Trimmed | None = Field(default=None, max_length=255)


class RouteRuleUpdateIn(InputModel):
    """改规则。缺省的字段表示本次不涉及。"""

    path_pattern: PathPattern | None = None
    http_method: HttpMethod | None = None
    permission_codes: list[Trimmed] | None = Field(default=None, max_length=50)
    match_mode: MatchMode | None = None
    priority: int | None = Field(default=None, ge=0, le=999)
    is_enabled: bool | None = None
    description: Trimmed | None = Field(default=None, max_length=255)
