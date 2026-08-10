"""权限目录的出参。目录是只读面，没有写入 schema。"""

import uuid
from typing import Literal

from auth_server.apps.auth.schemas.common import OutputModel

PermissionKind = Literal["view", "manage", "operate", "admin"]


class PermissionOut(OutputModel):
    """一条权限码。分组五列全部来自 DB，前端不再维护映射表。"""

    id: uuid.UUID
    code: str
    name: str
    description: str | None = None
    group_code: str
    group_label: str
    sort_order: int
    kind: PermissionKind
    is_builtin: bool


class PermissionGroupOut(OutputModel):
    """界面上的一个权限分组。"""

    code: str
    label: str
    items: list[PermissionOut]


class PermissionCatalogOut(OutputModel):
    """权限目录：扁平表与分组视图各给一份，前端按场景取用。"""

    items: list[PermissionOut]
    groups: list[PermissionGroupOut]
