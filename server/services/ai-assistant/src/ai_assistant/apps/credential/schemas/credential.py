"""凭据面的出入参。

⚠ 令牌本身**一个字都不出这道门**：出参里只有账号掩码、订阅档与过期时刻。
把 access_token 交给浏览器等于把整个订阅账号交出去，而它此后会躺在
每一个人的 devtools 里。
"""

from typing import Annotated

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    WithJsonSchema,
)

from ai_assistant.apps.credential.enums import PROVIDERS
from ai_assistant.apps.credential.schemas.common import Utc


def _known_provider(value: str) -> str:
    """未登记的模型来路一律拒。

    ⚠ 放行的话它会建出一行永远不会被任何一路读到的凭据，
    而界面上表现为「登录成功了但助手说没登录」。

    Args: value。
    """
    if value not in PROVIDERS:
        raise ValueError(f"未登记的模型来路：{value}")
    return value


# ⚠ `WithJsonSchema` 里必须摊出取值：闭合集合只写在校验器里的话，openapi 里
# 它就是裸 `string`，前端由它生成的类型于是允许任意字符串
Provider = Annotated[
    str,
    AfterValidator(_known_provider),
    WithJsonSchema({"type": "string", "enum": list(PROVIDERS)}),
]


class CredentialStatusOut(BaseModel):
    """一路模型的登录态。"""

    model_config = ConfigDict(frozen=True)

    provider: Provider
    # 登没登录过。为假时其余各格一律为空
    is_connected: bool
    # 账号标识的掩码，形如 `…a1b2c3`。⚠ 只回答「是不是我那个号」
    account_label: str | None = None
    # 订阅档位（上游给什么就是什么，我们不认它的取值）
    plan_label: str | None = None
    expires_at: Utc | None = None
    last_refresh_at: Utc | None = None
    # 最近一次续期失败的原因，给人看。为空表示一切正常
    last_error: str | None = None


class DeviceLoginStartOut(BaseModel):
    """设备码登录开了个头。"""

    model_config = ConfigDict(frozen=True)

    # 这次登录的句柄。⚠ 不是 device_code——那一格是密钥态，不下发
    ref: str
    # 让用户在验证页里输入的那一串
    user_code: str
    verification_uri: str
    # 建议的轮询间隔。⚠ 界面必须照它来：打快了上游会限流，
    # 而被限的是整台机器，不只是这一次登录
    interval_s: int
    expires_in_s: int


class DeviceLoginPollIn(BaseModel):
    """问一次「用户点完了没」。"""

    model_config = ConfigDict(frozen=True)

    ref: str = Field(min_length=1, max_length=128)


class DeviceLoginPollOut(BaseModel):
    """问了一次的结果。"""

    model_config = ConfigDict(frozen=True)

    is_done: bool
    # 下一次隔多久再问。⚠ 上游让慢下来时这个数会变大，界面要用回它
    interval_s: int
    # 登好之后的状态，省一次往返；没登好就是 None
    status: CredentialStatusOut | None = None
