"""向平台领订阅账号令牌的客户端。

守的是三件事：带服务级密钥打到写死的那条内部路径上（漂了就是「登录了却说没
登录」）；「还没登录」与「平台此刻不行」分成两档（混成一档的话，人会去查网络
而不是去登录）；以及**令牌不进异常信息**。
"""

import datetime as dt
from typing import Any

import httpx
import pytest

from llmcore import (
    CODEX_LEASE_PATH,
    CodexTokenClient,
    CredentialNotConnected,
    CredentialUnavailable,
)

KEY = "k" * 32
SECRET = "at-super-secret"


def _body() -> dict[str, Any]:
    later = dt.datetime.now(dt.UTC) + dt.timedelta(minutes=30)
    return {
        "code": 0,
        "message": "ok",
        "trace_id": "t",
        "data": {
            "access_token": SECRET,
            "expires_at": later.isoformat(),
            "account_id": "acc-1",
            "plan_type": "pro",
        },
    }


class _Upstream:
    """假平台：记下每次请求，按预置的应答回。"""

    def __init__(self, answer: httpx.Response | Exception) -> None:
        self.answer = answer
        self.requests: list[httpx.Request] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)


def _client(upstream: _Upstream) -> CodexTokenClient:
    made = CodexTokenClient(
        base_url="http://platform", service_key=KEY, timeout_s=2.0
    )
    made.use_transport(upstream.transport())
    return made


async def test_it_posts_to_the_credential_path_with_the_service_key() -> None:
    upstream = _Upstream(httpx.Response(200, json=_body()))
    token = await _client(upstream).usable("p1")
    request = upstream.requests[0]
    assert request.method == "POST"
    assert request.url.path == CODEX_LEASE_PATH.format(id="p1")
    assert request.headers["X-Service-Key"] == KEY
    assert token.access_token == SECRET
    assert token.account_id == "acc-1"
    assert token.plan_type == "pro"


@pytest.mark.parametrize(
    "answer",
    [
        httpx.Response(404, json={"code": 42408, "message": "x"}),
        httpx.Response(409, json={"code": 42409, "message": "x"}),
    ],
    ids=["never-logged-in", "refresh-rejected"],
)
async def test_a_lane_without_a_login_is_its_own_class(
    answer: httpx.Response,
) -> None:
    # ⚠ 与「暂时不可用」分开：这一档的处置是去登录一次，不是等一等
    with pytest.raises(CredentialNotConnected):
        await _client(_Upstream(answer)).usable("p1")


@pytest.mark.parametrize(
    "answer",
    [
        httpx.Response(503, json={"code": 52401, "message": "x"}),
        httpx.Response(200, content=b"not json"),
        httpx.Response(200, json={"code": 0, "data": {"nope": 1}}),
        httpx.ConnectError("refused"),
    ],
    ids=["disabled", "not-json", "malformed", "unreachable"],
)
async def test_any_other_failure_is_one_named_error(
    answer: httpx.Response | Exception,
) -> None:
    with pytest.raises(CredentialUnavailable):
        await _client(_Upstream(answer)).usable("p1")


async def test_the_token_never_shows_up_in_the_failure_text() -> None:
    # 回包里有令牌：把正文抄进异常等于把它抄进每一条错误日志
    upstream = _Upstream(httpx.Response(500, json=_body()))
    with pytest.raises(CredentialUnavailable) as raised:
        await _client(upstream).usable("p1")
    assert SECRET not in str(raised.value)
