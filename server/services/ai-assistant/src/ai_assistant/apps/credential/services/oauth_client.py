"""跟上游 OAuth 端点说话的那一层：设备码三步与刷新。

⚠ 端点地址、client_id、scope 全部**从 `langchain_openai.chatgpt_oauth` 取**，
不在这里抄一份字面量：抄下来的那份会在上游改地址时静默失效，而现象是
「登录页转圈转到超时」。契约用例钉住这几个名字还在不在。

⚠ 上游那个 `login_chatgpt_device` 用不了：它是同步的、`time.sleep` 轮询、
最后写文件——三条都塞不进一个异步 Web 服务。协议照它的，实现是我们自己的。

⚠ `slow_down` 必须把间隔抬上去（RFC 8628 §3.5）。照原间隔接着打的话，
上游会把这台机器限流，而那之后所有人的登录都开不了头。
"""

import base64
import datetime as dt
import hashlib
import secrets
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
# 收到 slow_down 时往上抬多少秒（RFC 8628 §3.5）
SLOW_DOWN_STEP_S = 5
# 这几档表示「用户还没点完」，不是失败
_PENDING_ERRORS = frozenset({"authorization_pending", "slow_down"})


@dataclass(frozen=True)
class DeviceCodeStart:
    """设备码登录开了个头。"""

    device_code: str
    user_code: str
    verification_uri: str
    interval_s: int
    expires_in_s: int


@dataclass(frozen=True)
class DeviceCodePoll:
    """轮询一次的结果。`authorization_code` 为空表示还没好。"""

    authorization_code: str | None
    interval_s: int


class OAuthClient:
    """上游 OAuth 端点的客户端。一个进程一份，连接池长活。"""

    def __init__(self, client: httpx.AsyncClient) -> None:
        """Args: client（外部注入，测试注假件）。"""
        self._client = client

    async def start_device_code(self, challenge: str) -> DeviceCodeStart:
        """要一个用户码与验证地址。

        Args: challenge（PKCE 的 code_challenge）。
        """
        body = await self._post(
            CHATGPT_DEVICE_CODE_URL,
            {
                "client_id": CHATGPT_CLIENT_ID,
                "scope": DEFAULT_SCOPE,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            },
        )
        start = _read_start(body)
        if start is None:
            raise LoginRejected("上游没给出可用的用户码，请稍后重试")
        return start

    async def poll_device_code(
        self, device_code: str, interval_s: int
    ) -> DeviceCodePoll:
        """问一次「用户点完了没」。

        Args: device_code, interval_s（当前轮询间隔）。
        """
        body = await self._post(
            CHATGPT_DEVICE_TOKEN_URL,
            {"client_id": CHATGPT_CLIENT_ID, "device_code": device_code},
        )
        code = body.get("authorization_code")
        if isinstance(code, str) and code:
            return DeviceCodePoll(
                authorization_code=code, interval_s=interval_s
            )
        error = body.get("error")
        if isinstance(error, str) and error not in _PENDING_ERRORS:
            raise LoginRejected(_rejection_of(error))
        next_interval = (
            interval_s + SLOW_DOWN_STEP_S
            if error == "slow_down"
            else interval_s
        )
        return DeviceCodePoll(authorization_code=None, interval_s=next_interval)

    async def exchange_code(self, code: str, verifier: str) -> TokenBundle:
        """拿授权码换一份令牌包。

        Args: code, verifier（PKCE 的 code_verifier）。
        """
        body = await self._post(
            CHATGPT_TOKEN_URL,
            {
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": CHATGPT_DEVICE_REDIRECT_URI,
                "client_id": CHATGPT_CLIENT_ID,
                "code_verifier": verifier,
            },
        )
        return _bundle_of(body, fallback_refresh=None)

    async def refresh(self, refresh_token: str) -> TokenBundle:
        """用 refresh_token 换一份新的。

        ⚠ 上游可能**不回**新的 refresh_token，那时要沿用手上这一份；
        当成没有的话，下一次刷新就没东西可用了。

        Args: refresh_token。
        """
        body = await self._post(
            CHATGPT_TOKEN_URL,
            {
                "grant_type": "refresh_token",
                "client_id": CHATGPT_CLIENT_ID,
                "refresh_token": refresh_token,
                "scope": DEFAULT_SCOPE,
            },
        )
        return _bundle_of(body, fallback_refresh=refresh_token)

    async def _post(self, url: str, form: dict[str, str]) -> dict[str, Any]:
        try:
            response = await self._client.post(
                url, data=form, timeout=HTTP_TIMEOUT_S
            )
        except httpx.HTTPError as error:
            raise UpstreamUnavailable("登录服务此刻连不上") from error
        return _read_body(response)


def make_pkce_pair() -> tuple[str, str]:
    """造一对 PKCE 的 (verifier, challenge)。

    ⚠ verifier 与 device_code 一样是**密钥态**：它只在服务端待着，
    一个字都不许下发给浏览器。
    """
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(64)).rstrip(b"=")
    digest = hashlib.sha256(verifier).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=")
    return verifier.decode("ascii"), challenge.decode("ascii")


def _read_body(response: httpx.Response) -> dict[str, Any]:
    """读响应体。

    ⚠ 4xx 也要把体读出来：OAuth 把 `authorization_pending` 这类**正常**状态
    也放在错误响应里，`raise_for_status` 会把「用户还没点完」变成一条异常。
    """
    try:
        body: Any = response.json()
    except ValueError:
        body = None
    if isinstance(body, dict):
        return cast("dict[str, Any]", body)
    if response.is_success:
        raise LoginRejected("上游回了一段读不懂的内容")
    raise UpstreamUnavailable("登录服务此刻不可用")


def _read_start(body: dict[str, Any]) -> DeviceCodeStart | None:
    device_code = body.get("device_code")
    user_code = body.get("user_code")
    uri = body.get("verification_uri_complete") or body.get("verification_uri")
    if not (
        isinstance(device_code, str)
        and isinstance(user_code, str)
        and isinstance(uri, str)
    ):
        return None
    return DeviceCodeStart(
        device_code=device_code,
        user_code=user_code,
        verification_uri=uri,
        interval_s=_int_or(body.get("interval"), DEFAULT_POLL_INTERVAL_S),
        expires_in_s=_int_or(body.get("expires_in"), 600),
    )


def _bundle_of(
    body: dict[str, Any], *, fallback_refresh: str | None
) -> TokenBundle:
    access = body.get("access_token")
    refresh = body.get("refresh_token") or fallback_refresh
    if not (isinstance(access, str) and isinstance(refresh, str)):
        raise LoginRejected("上游没给出可用的令牌，请重新登录")
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


def _rejection_of(error: str) -> str:
    if error == "expired_token":
        return "这次登录已经过期，请重新开始"
    if error == "access_denied":
        return "授权被拒绝"
    return "登录没有完成，请重新开始"


def _int_or(given: object, fallback: int) -> int:
    try:
        return int(str(given))
    except (TypeError, ValueError):
        return fallback
