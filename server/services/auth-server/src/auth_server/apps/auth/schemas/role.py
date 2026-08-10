"""角色面的入参与出参。"""

import uuid
from typing import Annotated

from pydantic import Field, StringConstraints

from auth_server.apps.auth.schemas.common import (
    InputModel,
    OutputModel,
    Trimmed,
    Utc,
)

RoleName = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=2,
        max_length=64,
        pattern=r"^[a-z][a-z0-9_]*$",
    ),
]
RoleDescription = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=255)
]


class RoleOut(OutputModel):
    """角色详情。`permissions` 是该角色持有的权限码。"""

    id: uuid.UUID
    name: str
    description: str | None = None
    is_builtin: bool
    created_at: Utc
    updated_at: Utc
    permissions: list[str]
    user_count: int


class RoleCreateIn(InputModel):
    """建角色，可同时给一组权限码。"""

    name: RoleName
    description: RoleDescription | None = None
    codes: list[Trimmed] = Field(default_factory=list[str], max_length=200)


class RoleUpdateIn(InputModel):
    """改角色。内置角色只允许改描述。"""

    name: RoleName | None = None
    description: RoleDescription | None = None


class RolePermissionsIn(InputModel):
    """覆盖式设置角色权限。"""

    codes: list[Trimmed] = Field(default_factory=list[str], max_length=200)
