"""用户面的入参与出参。

⚠ `RegistrationIn` 与 `UserUpdateIn` 都**不含** role/permission 字段，配合
`extra="forbid"` 让「自助注册顺手把自己设成管理员」在 schema 层就不成立。
"""

import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints

from auth_server.apps.auth.schemas.common import (
    InputModel,
    OutputModel,
    Trimmed,
    Utc,
)
from auth_server.apps.auth.schemas.password import RawPassword

Username = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=3,
        max_length=64,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$",
    ),
]
DisplayName = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=64)
]
Phone = Annotated[str, StringConstraints(strip_whitespace=True, max_length=32)]
Url = Annotated[str, StringConstraints(strip_whitespace=True, max_length=512)]


class RoleRef(OutputModel):
    """角色的引用形态（列表里不展开权限集）。"""

    id: uuid.UUID
    name: str
    description: str | None = None
    is_builtin: bool


class UserOut(OutputModel):
    """用户的对外形状。**永不包含口令散列。**"""

    id: uuid.UUID
    username: str
    email: str
    full_name: str | None = None
    avatar_url: str | None = None
    phone: str | None = None
    is_active: bool
    last_login_at: Utc | None = None
    created_at: Utc
    updated_at: Utc
    role: RoleRef


class UserListItemOut(UserOut):
    """用户列表项：直权只给条数，不展开码。

    ⚠ 列表刻意不展开权限集：那要对每一行再查角色权限与直权，一页 200 行就是
    几百次额外查询，而列表页真正要看的只是「这个人有没有额外授权」。
    完整的三组码只在详情端点给。**改这里要同步改 `@dt/contracts` 的
    `UserListItem`**，形状差异由前后端两侧的契约测试各钉一遍。
    """

    direct_permission_count: int


class UserDetailOut(UserOut):
    """用户详情：角色权限与直权分开返回，`permissions` 是两者的并集。"""

    role_permissions: list[str]
    direct_permissions: list[str]
    permissions: list[str]


class UserCreateIn(InputModel):
    """管理员建号。"""

    username: Username
    email: EmailStr
    password: RawPassword
    role_id: uuid.UUID
    full_name: DisplayName | None = None
    phone: Phone | None = None
    is_active: bool = True


class RegistrationIn(InputModel):
    """自助注册。角色由服务端按配置指派，请求方无从选择。"""

    username: Username
    email: EmailStr
    password: RawPassword
    full_name: DisplayName | None = None


class UserUpdateIn(InputModel):
    """管理员改他人资料。缺省的字段表示本次不涉及。"""

    email: EmailStr | None = None
    full_name: DisplayName | None = None
    avatar_url: Url | None = None
    phone: Phone | None = None


class MeUpdateIn(InputModel):
    """改自己的资料。改不了启停、角色与权限，因此不要求权限码。"""

    email: EmailStr | None = None
    full_name: DisplayName | None = None
    avatar_url: Url | None = None
    phone: Phone | None = None


class ChangePasswordIn(InputModel):
    """改自己的密码，必须验旧密码。"""

    current_password: str = Field(min_length=1, max_length=128)
    new_password: RawPassword


class ResetPasswordIn(InputModel):
    """管理员重置他人密码。"""

    new_password: RawPassword


class AssignRoleIn(InputModel):
    """改派角色。"""

    role_id: uuid.UUID


class SetPermissionsIn(InputModel):
    """覆盖式写直权：给什么就是什么，不做增量合并。"""

    codes: list[Trimmed] = Field(default_factory=list[str], max_length=200)


class UserFilters(BaseModel):
    """列表过滤条件。可过滤字段是白名单，不是把 query 拼进 SQL。

    ⚠ 这里必须 `extra="ignore"`：它是 query 容器而非请求体，与它并列的
    `page`/`size`/`sort` 对本模型都是「多余字段」，forbid 会让整个列表接口 400。
    """

    model_config = ConfigDict(extra="ignore")

    q: Trimmed | None = None
    is_active: bool | None = None
    role_id: uuid.UUID | None = None
