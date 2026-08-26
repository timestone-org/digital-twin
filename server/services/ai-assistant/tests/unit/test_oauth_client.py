"""设备码那三步与刷新。

守的全是「照着协议走，不然会被限流或静默失败」：`slow_down` 必须把间隔抬上去
（RFC 8628 §3.5），4xx 的体必须读出来（OAuth 把「用户还没点完」也放在错误响应
里），刷新回来没带新的 refresh_token 时要沿用手上那一份。
"""

import base64
import json
from typing import Any

import httpx
import pytest

from ai_assistant.apps.credential.errors import (
    LoginRejected,
    UpstreamUnavailable,
)
from ai_assistant.apps.credential.services.oauth_client import (
    SLOW_DOWN_STEP_S,
    OAuthClient,
    make_pkce_pair,
)


def _client(handler: httpx.MockTransport) -> OAuthClient:
    return OAuthClient(httpx.AsyncClient(transport=handler))


def _replies(*bodies: tuple[int, dict[str, Any]]) -> httpx.MockTransport:
    calls = iter(bodies)

    def handle(_request: httpx.Request) -> httpx.Response:
        status, body = next(calls)
        return httpx.Response(status, json=body)

    return httpx.MockTransport(handle)


def _id_token(claims: dict[str, Any]) -> str:
    def part(body: dict[str, Any]) -> str:
        raw = json.dumps(body).encode()
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    return f"{part({'alg': 'none'})}.{part(claims)}.sig"


async def test_a_start_carries_the_user_code_and_interval() -> None:
    client = _client(
        _replies(
            (
                200,
                {
                    "device_code": "dc-1",
                    "user_code": "ABCD-1234",
                    "verification_uri": "https://example.test/activate",
                    "interval": 7,
                    "expires_in": 900,
                },
            )
        )
    )
    started = await client.start_device_code("challenge")
    assert started.user_code == "ABCD-1234"
    assert started.interval_s == 7
    assert started.expires_in_s == 900


async def test_a_start_without_a_user_code_is_rejected() -> None:
    client = _client(_replies((200, {"device_code": "dc-1"})))
    with pytest.raises(LoginRejected):
        await client.start_device_code("challenge")


async def test_a_pending_poll_is_not_a_failure() -> None:
    # OAuth 把「用户还没点完」放在 4xx 里；当成失败的话登录永远开不了头
    client = _client(_replies((400, {"error": "authorization_pending"})))
    polled = await client.poll_device_code("dc-1", 5)
    assert polled.authorization_code is None
    assert polled.interval_s == 5


async def test_slow_down_raises_the_interval() -> None:
    # 照原间隔接着打的话，上游会把这台机器限流
    client = _client(_replies((400, {"error": "slow_down"})))
    polled = await client.poll_device_code("dc-1", 5)
    assert polled.interval_s == 5 + SLOW_DOWN_STEP_S


async def test_a_terminal_error_is_rejected() -> None:
    client = _client(_replies((400, {"error": "access_denied"})))
    with pytest.raises(LoginRejected):
        await client.poll_device_code("dc-1", 5)


async def test_a_finished_poll_hands_back_the_code() -> None:
    client = _client(_replies((200, {"authorization_code": "code-1"})))
    polled = await client.poll_device_code("dc-1", 5)
    assert polled.authorization_code == "code-1"


async def test_an_exchange_reads_the_account_out_of_the_id_token() -> None:
    id_token = _id_token(
        {
            "https://api.openai.com/auth": {
                "chatgpt_account_id": "acc-9",
                "chatgpt_plan_type": "pro",
            }
        }
    )
    client = _client(
        _replies(
            (
                200,
                {
                    "access_token": "at-1",
                    "refresh_token": "rt-1",
                    "expires_in": 3600,
                    "id_token": id_token,
                },
            )
        )
    )
    bundle = await client.exchange_code("code-1", "verifier")
    assert bundle.account_id == "acc-9"
    assert bundle.plan_type == "pro"


async def test_a_token_without_a_lifetime_is_rejected() -> None:
    # 存一份立刻就过期的令牌，等于每次对话都先失败一次再去刷新
    client = _client(
        _replies((200, {"access_token": "at-1", "refresh_token": "rt-1"}))
    )
    with pytest.raises(LoginRejected):
        await client.exchange_code("code-1", "verifier")


async def test_a_refresh_keeps_the_old_refresh_token() -> None:
    # 上游可能不回新的；当成没有的话，下一次刷新就没东西可用了
    client = _client(
        _replies((200, {"access_token": "at-2", "expires_in": 3600}))
    )
    bundle = await client.refresh("rt-1")
    assert bundle.access_token == "at-2"
    assert bundle.refresh_token == "rt-1"


async def test_a_dead_endpoint_is_unavailable_not_rejected() -> None:
    def blow_up(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    client = _client(httpx.MockTransport(blow_up))
    with pytest.raises(UpstreamUnavailable):
        await client.poll_device_code("dc-1", 5)


def test_a_pkce_pair_is_url_safe_and_unpadded() -> None:
    verifier, challenge = make_pkce_pair()
    assert "=" not in verifier
    assert "=" not in challenge
    assert verifier != challenge


async def test_a_success_body_that_is_not_json_is_rejected() -> None:
    def html(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, text="<html>反代插了一段</html>")

    client = _client(httpx.MockTransport(html))
    with pytest.raises(LoginRejected):
        await client.poll_device_code("dc-1", 5)


async def test_an_error_body_that_is_not_json_is_unavailable() -> None:
    def gateway(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(502, text="bad gateway")

    client = _client(httpx.MockTransport(gateway))
    with pytest.raises(UpstreamUnavailable):
        await client.poll_device_code("dc-1", 5)


async def test_an_unreadable_id_token_does_not_fail_the_login() -> None:
    # 账号信息只用来在界面上显示「挂着的是哪个号」，为它让整次登录失败不值当
    client = _client(
        _replies(
            (
                200,
                {
                    "access_token": "at-1",
                    "refresh_token": "rt-1",
                    "expires_in": 3600,
                    "id_token": "这不是一个 JWT",
                },
            )
        )
    )
    bundle = await client.exchange_code("code-1", "verifier")
    assert bundle.account_id is None


async def test_an_id_token_without_our_namespace_yields_no_account() -> None:
    client = _client(
        _replies(
            (
                200,
                {
                    "access_token": "at-1",
                    "refresh_token": "rt-1",
                    "expires_in": 3600,
                    "id_token": _id_token({"sub": "u-1"}),
                },
            )
        )
    )
    bundle = await client.exchange_code("code-1", "verifier")
    assert bundle.plan_type is None


async def test_an_expired_device_code_says_so() -> None:
    client = _client(_replies((400, {"error": "expired_token"})))
    with pytest.raises(LoginRejected, match="过期"):
        await client.poll_device_code("dc-1", 5)


async def test_an_unknown_error_still_reads_as_rejected() -> None:
    client = _client(_replies((400, {"error": "什么新花样"})))
    with pytest.raises(LoginRejected):
        await client.poll_device_code("dc-1", 5)
