"""跟上游 OAuth 端点说话的那一层：设备码三步与刷新。

⚠ 设备码那两跳**不是 RFC 8628**，是供应商自己的一套，与标准差四处（每一处都是
实测出来的；照 RFC 或照 `langchain_openai.chatgpt_oauth` 里那份写，一定不通）：

1. 体是 **JSON** 不是表单编码。发表单收到的是一句「Input should be a valid
   dictionary or object」，与「设备码流程不可用」毫无关系。
2. 句柄叫 **`device_auth_id`**，不叫 `device_code`。
3. **PKCE 的 verifier 由服务端生成**，在轮询成功那一下连着授权码一起给回来——
   本地先造一份再拿去换，换到的是一条 `invalid_grant`。
4. 响应里**没有 `verification_uri`**，让人打开的地址是个常量
   （`{issuer}/codex/device`）。

⚠ client_id 与端点地址仍从 `langchain_openai.chatgpt_oauth` 取，不抄字面量：
那几个它是对的，抄下来的那份会在上游改地址时静默失效。

⚠ 刷新与授权码交换走的是标准 OAuth 的 `/oauth/token`，那一条**是表单编码**。
两半各按各的口径，别顺手统一。
"""

import datetime as dt
from dataclasses import dataclass
from typing import Any, cast

import httpx
from langchain_openai.chatgpt_oauth import (
    CHATGPT_CLIENT_ID,
    CHATGPT_DEVICE_CODE_URL,
    CHATGPT_DEVICE_REDIRECT_URI,
    CHATGPT_DEVICE_TOKEN_URL,
    CHATGPT_TOKEN_URL,
    DEFAULT_SCOPE,
    decode_jwt_claims,
)

from ai_assistant.apps.credential.errors import (
    LoginRejected,
    UpstreamUnavailable,
)
from ai_assistant.apps.credential.services.tokens import (
    CLAIMS_NAMESPACE,
    TokenBundle,
)

# 一次 HTTP 往返的上限。⚠ 必须小于端点自己的轮询间隔，否则一次卡住的轮询
# 会把下一次也顶到后面去
HTTP_TIMEOUT_S = 10.0
# 上游没给间隔时按这个数轮询
DEFAULT_POLL_INTERVAL_S = 5
# 上游没给有效期时按这个数倒计时
DEFAULT_EXPIRES_IN_S = 900
# 让人在浏览器里打开的那个地址。⚠ 是常量：设备码那一跳的响应里没有它
VERIFICATION_URI = "https://auth.openai.com/codex/device"
# 「用户还没点完」的两种表达：上游用 403/404 表示等待，同时在体里给这个码
_PENDING_STATUSES = frozenset({403, 404})
_PENDING_CODE = "deviceauth_authorization_pending"
_HEADERS = {"Accept": "application/json"}


@dataclass(frozen=True)
class DeviceCodeStart:
    """设备码登录开了个头。"""

    # ⚠ 是 `device_auth_id` 不是 `device_code`：名字对不上就一路 422
    device_auth_id: str
    user_code: str
    verification_uri: str
    interval_s: int
    expires_in_s: int


@dataclass(frozen=True)
class DeviceCodeGrant:
    """轮询到的授权。

    ⚠ `code_verifier` 是**服务端给的**：本地另造一份拿去换，换到的是一条
    `invalid_grant`，而那条错与「登录没完成」看着一模一样。
    """

    authorization_code: str
    code_verifier: str


@dataclass(frozen=True)
class DeviceCodePoll:
    """轮询一次的结果。`grant` 为空表示还没好。"""

    grant: DeviceCodeGrant | None
    interval_s: int


class OAuthClient:
    """上游 OAuth 端点的客户端。一个进程一份，连接池长活。"""

    def __init__(self, client: httpx.AsyncClient) -> None:
        """Args: client（外部注入，测试注假件）。"""
        self._client = client

    async def start_device_code(self) -> DeviceCodeStart:
        """要一个用户码。

        ⚠ 只带 client_id：PKCE 由服务端管，这里给了也没人看。
        """
        body = await self._posted(
            CHATGPT_DEVICE_CODE_URL,
            {"client_id": CHATGPT_CLIENT_ID},
            is_form=False,
        )
        start = _read_start(body)
        if start is None:
            raise LoginRejected(_why(body, "上游没给出可用的用户码"))
        return start

    async def poll_device_code(
        self, *, device_auth_id: str, user_code: str, interval_s: int
    ) -> DeviceCodePoll:
        """问一次「用户点完了没」。

        Args: device_auth_id, user_code, interval_s（当前轮询间隔）。
        """
        response = await self._send(
            CHATGPT_DEVICE_TOKEN_URL,
            {
                "client_id": CHATGPT_CLIENT_ID,
                "device_auth_id": device_auth_id,
                "user_code": user_code,
            },
            is_form=False,
        )
        body = _read_body(response)
        if response.is_success:
            grant = _read_grant(body)
            if grant is None:
                raise LoginRejected(_why(body, "上游没给出可用的授权"))
            return DeviceCodePoll(grant=grant, interval_s=interval_s)
        if _is_pending(response.status_code, body):
            return DeviceCodePoll(grant=None, interval_s=interval_s)
        raise LoginRejected(_why(body, "登录没有完成，请重新开始"))

    async def exchange_code(self, grant: DeviceCodeGrant) -> TokenBundle:
        """拿授权码换一份令牌包。

        ⚠ 这一跳是标准 OAuth，**表单编码**，与上面两跳不同口径。

        Args: grant。
        """
        body = await self._posted(
            CHATGPT_TOKEN_URL,
            {
                "grant_type": "authorization_code",
                "code": grant.authorization_code,
                "redirect_uri": CHATGPT_DEVICE_REDIRECT_URI,
                "client_id": CHATGPT_CLIENT_ID,
                "code_verifier": grant.code_verifier,
            },
            is_form=True,
        )
        return _bundle_of(body, fallback_refresh=None)

    async def refresh(self, refresh_token: str) -> TokenBundle:
        """用 refresh_token 换一份新的。

        ⚠ 上游可能**不回**新的 refresh_token，那时要沿用手上这一份；
        当成没有的话，下一次刷新就没东西可用了。

        Args: refresh_token。
        """
        body = await self._posted(
            CHATGPT_TOKEN_URL,
            {
                "grant_type": "refresh_token",
                "client_id": CHATGPT_CLIENT_ID,
                "refresh_token": refresh_token,
                "scope": DEFAULT_SCOPE,
            },
            is_form=True,
        )
        return _bundle_of(body, fallback_refresh=refresh_token)

    async def _send(
        self, url: str, body: dict[str, str], *, is_form: bool
    ) -> httpx.Response:
        """发一跳；连不上就抬成「服务不可达」。

        Args: url, body, is_form。
        """
        try:
            if is_form:
                return await self._client.post(
                    url, data=body, headers=_HEADERS, timeout=HTTP_TIMEOUT_S
                )
            return await self._client.post(
                url, json=body, headers=_HEADERS, timeout=HTTP_TIMEOUT_S
            )
        except httpx.HTTPError as error:
            raise UpstreamUnavailable("登录服务此刻连不上") from error

    async def _posted(
        self, url: str, body: dict[str, str], *, is_form: bool
    ) -> dict[str, Any]:
        response = await self._send(url, body, is_form=is_form)
        read = _read_body(response)
        if response.is_success:
            return read
        raise LoginRejected(_why(read, "登录没有完成，请重新开始"))


def _read_body(response: httpx.Response) -> dict[str, Any]:
    """读响应体；读不出给空表。

    ⚠ 4xx 的体也要读出来：上游把「用户还没点完」放在错误响应里，
    而分档要看体里那个码。

    Args: response。
    """
    try:
        body: Any = response.json()
    except ValueError:
        return {}
    return cast("dict[str, Any]", body) if isinstance(body, dict) else {}


def _error_of(body: dict[str, Any]) -> dict[str, Any]:
    """上游的错误对象。⚠ 它**嵌在 `error` 里**，不是顶层几个平铺字段。

    Args: body。
    """
    nested = body.get("error")
    if isinstance(nested, dict):
        return cast("dict[str, Any]", nested)
    return {}


def _is_pending(status: int, body: dict[str, Any]) -> bool:
    """这一次是「还在等人点」而不是失败。

    ⚠ 两条都要认：上游用 **403/404** 表示等待（不是 400），体里另给一个码。
    只认其中一条的话，等待会被读成失败，登录页在人还没点完时就红了。

    Args: status, body。
    """
    if status in _PENDING_STATUSES:
        return True
    return _error_of(body).get("code") == _PENDING_CODE


def _why(body: dict[str, Any], fallback: str) -> str:
    """把上游那句话带出来。

    ⚠ 带上它是刻意的：不带的话，任何一种上游变更都收敛成同一句「请稍后重试」，
    而那句话指不回任何地方——这条路本来就走在一个没有公开契约的端点上。
    上游这几条消息里只有校验信息，不含地址与密钥。

    Args: body, fallback。
    """
    said = _error_of(body).get("message")
    return f"{fallback}：{said}" if isinstance(said, str) and said else fallback


def _read_start(body: dict[str, Any]) -> DeviceCodeStart | None:
    device_auth_id = body.get("device_auth_id")
    user_code = body.get("user_code")
    if not (isinstance(device_auth_id, str) and isinstance(user_code, str)):
        return None
    return DeviceCodeStart(
        device_auth_id=device_auth_id,
        user_code=user_code,
        verification_uri=VERIFICATION_URI,
        # ⚠ `interval` 上游给的是**字符串**
        interval_s=_int_or(body.get("interval"), DEFAULT_POLL_INTERVAL_S),
        expires_in_s=_expires_in(body.get("expires_at")),
    )


def _read_grant(body: dict[str, Any]) -> DeviceCodeGrant | None:
    code = body.get("authorization_code")
    verifier = body.get("code_verifier")
    if not (isinstance(code, str) and isinstance(verifier, str)):
        return None
    return DeviceCodeGrant(authorization_code=code, code_verifier=verifier)


def _expires_in(given: object) -> int:
    """把上游给的**绝对时刻**换成还剩多少秒。

    ⚠ 它给的是 `expires_at` 不是 `expires_in`：当成秒数用的话，界面上会显示
    一个二十亿秒的倒计时。

    Args: given。
    """
    if not isinstance(given, str):
        return DEFAULT_EXPIRES_IN_S
    try:
        deadline = dt.datetime.fromisoformat(given)
    except ValueError:
        return DEFAULT_EXPIRES_IN_S
    return max(int((deadline - dt.datetime.now(dt.UTC)).total_seconds()), 0)


def _bundle_of(
    body: dict[str, Any], *, fallback_refresh: str | None
) -> TokenBundle:
    access = body.get("access_token")
    refresh = body.get("refresh_token") or fallback_refresh
    if not (isinstance(access, str) and isinstance(refresh, str)):
        raise LoginRejected(_why(body, "上游没给出可用的令牌，请重新登录"))
    expires_in = _int_or(body.get("expires_in"), 0)
    if expires_in <= 0:
        # 存一份立刻就过期的令牌，等于每次对话都先失败一次再去刷新
        raise LoginRejected("上游给的令牌没有有效期，请重新登录")
    id_token = body.get("id_token")
    claims = _claims_of(id_token if isinstance(id_token, str) else None)
    return TokenBundle(
        access_token=access,
        refresh_token=refresh,
        expires_at=dt.datetime.now(dt.UTC) + dt.timedelta(seconds=expires_in),
        id_token=id_token if isinstance(id_token, str) else None,
        account_id=claims.get("chatgpt_account_id"),
        plan_type=claims.get("chatgpt_plan_type"),
    )


def _claims_of(id_token: str | None) -> dict[str, str]:
    """从 id_token 里取那几格自定义声明；读不出就当没有。

    ⚠ 读不出不是错：账号信息只用来在界面上显示「挂着的是哪个号」，
    为它让整次登录失败不值当。

    Args: id_token。
    """
    if id_token is None:
        return {}
    try:
        claims: dict[str, Any] = decode_jwt_claims(id_token)
    except (ValueError, TypeError):
        return {}
    scoped = claims.get(CLAIMS_NAMESPACE)
    if not isinstance(scoped, dict):
        return {}
    fields = cast("dict[str, Any]", scoped)
    return {
        key: value for key, value in fields.items() if isinstance(value, str)
    }


def _int_or(given: object, fallback: int) -> int:
    try:
        return int(str(given))
    except (TypeError, ValueError):
        return fallback
