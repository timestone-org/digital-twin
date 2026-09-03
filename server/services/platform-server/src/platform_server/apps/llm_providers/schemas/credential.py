"""登录态那一面的出入参。

⚠ 令牌本身**一个字都不出对外这道门**：出参里只有账号掩码、订阅档与过期时刻。
把 access_token 交给浏览器等于把整个订阅账号交出去，而它此后会躺在每一个人的
devtools 里。只有内部面那一条下发短时令牌，而它不进 openapi。
"""

import uuid

from pydantic import Field

from platform_server.apps.llm_providers.schemas.common import (
    InputModel,
    OutputModel,
    Utc,
)


class LlmCredentialOut(OutputModel):
    """一路供应商的登录态。"""

    provider_id: uuid.UUID
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


class LlmDeviceLoginStartOut(OutputModel):
    """设备码登录开了个头。"""

    # 这次登录的句柄。⚠ 不是 device_auth_id——那一格是密钥态，不下发
    ref: str
    # 让用户在验证页里输入的那一串
    user_code: str
    verification_uri: str
    # 建议的轮询间隔。⚠ 界面必须照它来：打快了上游会限流，
    # 而被限的是整台机器，不只是这一次登录
    interval_s: int
    expires_in_s: int


class LlmDeviceLoginPollIn(InputModel):
    """问一次「用户点完了没」。"""

    ref: str = Field(min_length=1, max_length=128)


class LlmDeviceLoginPollOut(OutputModel):
    """问了一次的结果。"""

    is_done: bool
    # 下一次隔多久再问。⚠ 上游让慢下来时这个数会变大，界面要用回它
    interval_s: int
    # 登好之后的状态，省一次往返；没登好就是 None
    credential: LlmCredentialOut | None = None


class LlmCredentialTokenOut(OutputModel):
    """内部面下发的一份短时令牌。⚠ 只走 `/internal/`，不进 openapi。"""

    access_token: str
    expires_at: Utc
    # 进上游请求头，少了它后端认不出是哪个订阅。⚠ 这一格不出对外面
    account_id: str | None = None
    plan_type: str | None = None
