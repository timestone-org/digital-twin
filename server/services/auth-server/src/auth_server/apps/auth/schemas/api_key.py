"""API 密钥面的入参与出参。

⚠ 出参里**只有前缀，没有明文**。明文只在签发那一次的 `ApiKeySecretOut` 里出现，
之后任何读面都拿不回它——库里只有散列，我们自己也拿不回。
"""

import uuid
from typing import Annotated

from pydantic import Field, StringConstraints

from auth_server.apps.auth.models import NAME_MAX_LENGTH
from auth_server.apps.auth.schemas.common import (
    InputModel,
    OutputModel,
    Utc,
)

KeyName = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, min_length=1, max_length=NAME_MAX_LENGTH
    ),
]

MIN_TTL_DAYS = 1
MAX_TTL_DAYS = 3650


class ApiKeyCreateIn(InputModel):
    """签发一枚密钥。

    ⚠ `expires_in_days` 没有默认值，`null` 要显式写出来：一枚永不过期的密钥
    必须是有人主动选的，不能是漏填字段的结果。
    """

    user_id: uuid.UUID
    name: KeyName
    expires_in_days: int | None = Field(ge=MIN_TTL_DAYS, le=MAX_TTL_DAYS)


class ApiKeyOut(OutputModel):
    """一枚密钥的元信息。`is_active` = 未吊销且未过期。"""

    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    prefix: str
    is_active: bool
    expires_at: Utc | None = None
    last_used_at: Utc | None = None
    revoked_at: Utc | None = None
    created_at: Utc


class ApiKeySecretOut(OutputModel):
    """签发结果。`secret` 是明文，**只此一次**。"""

    api_key: ApiKeyOut
    secret: str


class ApiKeyFilters(InputModel):
    """列表过滤条件。默认只列还没吊销的。"""

    user_id: uuid.UUID | None = None
    should_include_revoked: bool = False
