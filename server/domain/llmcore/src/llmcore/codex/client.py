"""向平台领一份此刻能用的订阅账号令牌：内部面 + 服务级密钥，一跳，不重试。

⚠ 只领不刷（ADR-0041）：刷新是写操作，属主只有平台一个。两个消费方各自刷新
同一个 refresh_token 会互相把对方的令牌作废，而现象是「用着用着就掉登录」。
平台在下发前自己判该不该刷。

⚠ 这一层**不缓存**：令牌是有寿命的东西，缓存一份等于在「界面上退出登录了」
与「这一路还在说话」之间开一个说不清多久的窗口。一次内部往返比这便宜。

⚠ 这一层**不重试**：一条链路只有一层负责重试，而那一层是编排层
（runtime-resilience §4.2）。

⚠ 令牌不进日志、不进异常信息。
"""

import datetime as dt
from dataclasses import dataclass
from typing import Any, cast

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from lib.errors import DependencyUnavailable
from llmcore.errors import ModelDisabled

# 平台内部面上「领一份令牌」的路径。⚠ 与平台侧的路由逐字一致，由契约用例守着
CODEX_LEASE_PATH = "/internal/v1/platform/llm-credentials/{id}:token"
SERVICE_KEY_HEADER = "X-Service-Key"

# 「这一路还没登录过」。⚠ 平台用 404 说这件事
_NOT_CONNECTED = 404
# 「登录过，但那份 refresh_token 已经不认了」——要人重新登一次，不是等一等
_RECONNECT_NEEDED = 409


class CredentialNotConnected(ModelDisabled):
    """这一路订阅账号还没登录，或者登录已经失效。

    ⚠ 与「模型端点暂时不可用」分开：这一条的处置是「去登录一次」，
    那一条是「等一会儿再试」。混成一档的话，人会去查网络。
    """

    code = 52205


class CredentialUnavailable(DependencyUnavailable):
    """登录态此刻取不到（平台不可达、或它自己也说不清）。"""

    code = 52206


@dataclass(frozen=True)
class LeasedToken:
    """平台下发的一份短时令牌。⚠ refresh_token 不在里面，也永远不该在。"""

    access_token: str
    account_id: str | None
    plan_type: str | None
    expires_at: dt.datetime


class CodexTokenClient:
    """打平台内部凭据面的瘦客户端。构造不连网，一个进程一份。"""

    def __init__(
        self, *, base_url: str, service_key: str, timeout_s: float
    ) -> None:
        """按地址与密钥初始化。

        Args: base_url, service_key, timeout_s。
        """
        self._base_url = base_url.rstrip("/")
        self._service_key = service_key
        self._timeout_s = timeout_s
        # 传输层留成可替换的：用例验的是调用形状与失败处置，不是 httpx 本身
        self._transport: httpx.AsyncBaseTransport | None = None

    def use_transport(self, transport: httpx.AsyncBaseTransport) -> None:
        """换掉传输层。只给测试用。

        Args: transport。
        """
        self._transport = transport

    async def usable(self, provider: str) -> LeasedToken:
        """领一份此刻能用的令牌。

        Args: provider（那一路供应商的 id）。
        """
        response = await self._sent(provider)
        if response.status_code == _NOT_CONNECTED:
            raise CredentialNotConnected(
                "这一路订阅账号还没登录，去模型管理页登录一次"
            )
        if response.status_code == _RECONNECT_NEEDED:
            raise CredentialNotConnected(
                "这一路订阅账号的登录已失效，去模型管理页重新登录一次"
            )
        return _leased(response)

    async def _sent(self, provider: str) -> httpx.Response:
        """发那一跳；连不上就抬成「此刻取不到」。

        Args: provider。
        """
        path = CODEX_LEASE_PATH.format(id=provider)
        try:
            async with httpx.AsyncClient(
                base_url=self._base_url,
                timeout=self._timeout_s,
                transport=self._transport,
            ) as client:
                return await client.post(
                    path, headers={SERVICE_KEY_HEADER: self._service_key}
                )
        except httpx.HTTPError as error:
            raise CredentialUnavailable("订阅账号的登录态此刻取不到") from error


class _TokenWire(BaseModel):
    """内部接口 `data` 段的形状。"""

    model_config = ConfigDict(extra="ignore")

    access_token: str = Field(min_length=1)
    expires_at: dt.datetime
    account_id: str | None = None
    plan_type: str | None = None


class _Envelope(BaseModel):
    """统一信封，本地只取 data。"""

    model_config = ConfigDict(extra="ignore")

    data: object = None


def _leased(response: httpx.Response) -> LeasedToken:
    """把回包解成一份令牌；任何解不开都抬成「此刻取不到」。

    ⚠ 异常信息里不带回包正文：那一段里有令牌。

    Args: response。
    """
    try:
        response.raise_for_status()
        body: Any = response.json()
        wire = _TokenWire.model_validate(
            _Envelope.model_validate(cast("object", body)).data
        )
    except (httpx.HTTPError, ValidationError, ValueError) as error:
        raise CredentialUnavailable("订阅账号的登录态此刻取不到") from error
    return LeasedToken(
        access_token=wire.access_token,
        account_id=wire.account_id,
        plan_type=wire.plan_type,
        expires_at=wire.expires_at,
    )
