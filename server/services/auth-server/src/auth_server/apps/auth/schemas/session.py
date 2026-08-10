"""会话面（登录、刷新、登出）的入参与出参。"""

from pydantic import Field

from auth_server.apps.auth.schemas.common import InputModel, OutputModel
from auth_server.apps.auth.schemas.user import UserDetailOut


class LoginIn(InputModel):
    """账号口令登录。"""

    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)


class RefreshIn(InputModel):
    """用刷新令牌换一对新令牌。"""

    refresh_token: str = Field(min_length=1, max_length=4096)


class TokenPairOut(OutputModel):
    """一对令牌。`expires_in_s` 是 access token 的剩余秒数。"""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"  # noqa: S105  OAuth2 令牌类型，不是口令
    expires_in_s: int


class SessionOut(OutputModel):
    """登录结果：令牌 + 当前用户（含权限码，省去前端再拉一次）。"""

    token: TokenPairOut
    user: UserDetailOut
