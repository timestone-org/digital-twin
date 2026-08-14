"""内置角色 —— 权限集从权限码目录机械推导，不手抄清单。

手抄的清单会在加码时静默漏项：admin 角色少一个码不会有任何报错。
"""

from auth_server.apps.auth.catalog.permissions import ALL_CODES, VIEW_CODES
from auth_server.apps.auth.catalog.specs import RoleSpec

ROLE_ADMIN = "admin"
ROLE_VIEWER = "viewer"

ROLES: tuple[RoleSpec, ...] = (
    RoleSpec(
        name=ROLE_ADMIN,
        description="管理员：持有全部权限码",
        codes=tuple(sorted(ALL_CODES)),
    ),
    RoleSpec(
        name=ROLE_VIEWER,
        description="只读用户：持有全部查看档权限码",
        codes=VIEW_CODES,
    ),
)
