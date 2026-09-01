"""打 auth-server 内部面的瘦客户端：给到期的委托身份续签。

⚠ 只做这一件事。助手不认令牌、不查规则、不判权限——它拿回来的是 auth-server
当下从库里读出来的那份签名头，签发者始终只有一个。

⚠ 用的是服务级密钥而不是用户令牌：一个回合能跑几分钟，而用户的 access token
只有十几分钟，把续签挂在它上面等于把两条到期时间拴在一起，且现象同样是一句
「请重新登录」。

⚠ 这一层**不重试**：一条链路只有一层负责重试（runtime-resilience §4.2）。
"""

import httpx

from lib.errors import DependencyUnavailable
from lib.logging import current_traceparent, get_logger

_logger = get_logger("assistant.upstream.auth")

_REISSUE = "/internal/v1/users/{user_id}/edge-headers"

# 要收下的那几个。⚠ 与 `identity.FORWARDED` 同源：少收一个就是下一次调用
# 「齐全但少一格」，而下游报的是签名不符
_TAKEN = (
    "X-Auth-User-Id",
    "X-Auth-Username",
    "X-Auth-Role",
    "X-Auth-Permissions",
    "X-Auth-Permissions-Truncated",
    "X-Auth-Exp",
    "X-Auth-Sig",
)


class AuthUnavailable(DependencyUnavailable):
    """auth-server 没答上来，身份续不上。"""

    code = 52213


class AuthClient:
    """构造不连网；连接池一个进程一份。"""

    def __init__(
        self, *, base_url: str, service_key: str, timeout_s: float
    ) -> None:
        """按地址、服务级密钥与超时初始化。

        Args: base_url, service_key, timeout_s。
        """
        self._base_url = base_url.rstrip("/")
        self._service_key = service_key
        self._timeout_s = timeout_s
        # 传输层留成可替换的：用例验的是调用形状与失败处置，不是 httpx 本身
        self._transport: httpx.AsyncBaseTransport | None = None
        self._http: httpx.AsyncClient | None = None

    def use_transport(self, transport: httpx.AsyncBaseTransport) -> None:
        """换掉传输层。只给测试用；必须在第一次调用之前换。

        Args: transport。
        """
        self._transport = transport

    async def close(self) -> None:
        """关连接池。装了就要关，否则退出时留下一组还开着的 socket。"""
        http, self._http = self._http, None
        if http is not None:
            await http.aclose()

    async def reissue_headers(self, user_id: str) -> dict[str, str]:
        """为这个用户重新签一份身份头。

        ⚠ 失败一律抛。悄悄回一份空头的话，下一次调用会带着「齐全但为空」的
        一组头出去，而下游报的是签名不符——听起来像被篡改。

        Args: user_id。
        """
        path = _REISSUE.format(user_id=user_id)
        try:
            response = await self._client().get(
                path,
                headers={
                    "X-Service-Key": self._service_key,
                    "traceparent": current_traceparent(),
                },
            )
            response.raise_for_status()
        except httpx.HTTPError as error:
            _logger.warning(
                "identity_reissue_failed",
                "身份续签失败",
                error_type=type(error).__name__,
            )
            raise AuthUnavailable(_reason(error)) from error
        return {
            name: response.headers[name]
            for name in _TAKEN
            if response.headers.get(name)
        }

    def _client(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(
                base_url=self._base_url,
                timeout=self._timeout_s,
                transport=self._transport,
            )
        return self._http


def _reason(error: httpx.HTTPError) -> str:
    """把失败翻成一句给用户看的话。

    Args: error。
    """
    if isinstance(error, httpx.HTTPStatusError):
        return f"auth 回了 {error.response.status_code}，身份续不上"
    return "auth 没答上来，身份续不上"
