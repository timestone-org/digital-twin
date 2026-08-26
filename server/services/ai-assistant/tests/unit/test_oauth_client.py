"""设备码那两跳与刷新。

⚠ 这一族用例钉的是**实测出来的线形**，不是 RFC 8628：那两跳是供应商自己的一套，
四处与标准不同（JSON 体、`device_auth_id`、verifier 由服务端给、地址是常量）。
照标准写的实现在这里全红——这正是它们存在的理由。
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
    VERIFICATION_URI,
    DeviceCodeGrant,
    OAuthClient,
)


def _grant() -> DeviceCodeGrant:
    return DeviceCodeGrant(
        authorization_code="code-1", code_verifier="ver-from-server"
    )


START_BODY = {
    "device_auth_id": "deviceauth_abc123",
    "user_code": "D1DS-ER4CN",
    # ⚠ 上游给的是字符串，不是数字
    "interval": "5",
    # ⚠ 给的是绝对时刻，不是 expires_in
    "expires_at": "2099-01-01T00:00:00+00:00",
}
GRANT_BODY = {
    "authorization_code": "code-1",
    "code_challenge": "chal",
    "code_verifier": "ver-from-server",
}


def _client(handler: httpx.MockTransport) -> OAuthClient:
    return OAuthClient(httpx.AsyncClient(transport=handler))


def _replies(*bodies: tuple[int, dict[str, Any]]) -> httpx.MockTransport:
    calls = iter(bodies)

    def handle(_request: httpx.Request) -> httpx.Response:
        status, body = next(calls)
        return httpx.Response(status, json=body)

    return httpx.MockTransport(handle)


def _recorded(
    seen: list[httpx.Request], *bodies: tuple[int, dict[str, Any]]
) -> httpx.MockTransport:
    calls = iter(bodies)

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        status, body = next(calls)
        return httpx.Response(status, json=body)

    return httpx.MockTransport(handle)


def _pending(code: str = "deviceauth_authorization_pending") -> dict[str, Any]:
    return {
        "error": {"message": "Device authorization is pending.", "code": code}
    }


def _id_token(claims: dict[str, Any]) -> str:
    def part(body: dict[str, Any]) -> str:
        raw = json.dumps(body).encode()
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    return f"{part({'alg': 'none'})}.{part(claims)}.sig"


async def test_the_device_code_hop_posts_json_not_a_form() -> None:
    # 发表单收到的是「Input should be a valid dictionary or object」，
    # 与「设备码流程不可用」毫无关系
    seen: list[httpx.Request] = []
    client = _client(_recorded(seen, (200, START_BODY)))
    await client.start_device_code()
    assert seen[0].headers["content-type"].startswith("application/json")
    assert json.loads(seen[0].content) == {
        "client_id": "app_EMoamEEZ73f0CkXaXp7hrann"
    }


async def test_a_start_reads_the_handle_the_interval_and_the_deadline() -> None:
    client = _client(_replies((200, START_BODY)))
    started = await client.start_device_code()
    assert started.device_auth_id == "deviceauth_abc123"
    assert started.user_code == "D1DS-ER4CN"
    # 字符串的 interval 要收成数字
    assert started.interval_s == 5
    # 绝对时刻要换成还剩多少秒；当成秒数用的话界面上是二十亿秒的倒计时
    assert started.expires_in_s > 0
    # 响应里没有这一格，地址是常量
    assert started.verification_uri == VERIFICATION_URI


async def test_a_start_without_a_handle_carries_the_upstream_reason() -> None:
    # 不带上游那句话的话，任何一种上游变更都收敛成同一句「请稍后重试」
    client = _client(
        _replies((200, {"error": {"message": "client_id 不对", "code": "x"}}))
    )
    with pytest.raises(LoginRejected, match="client_id 不对"):
        await client.start_device_code()


async def test_the_poll_hop_sends_the_handle_and_the_user_code() -> None:
    seen: list[httpx.Request] = []
    client = _client(_recorded(seen, (200, GRANT_BODY)))
    await client.poll_device_code(
        device_auth_id="deviceauth_abc123", user_code="D1DS-ER4CN", interval_s=5
    )
    body = json.loads(seen[0].content)
    # ⚠ 少一格就是 422，而那条 422 里不会提到少的是哪一格
    assert body["device_auth_id"] == "deviceauth_abc123"
    assert body["user_code"] == "D1DS-ER4CN"


async def test_a_403_means_still_waiting_not_a_failure() -> None:
    # 上游用 403/404 表示等待。当成失败的话，人还没点完登录页就红了
    client = _client(_replies((403, _pending())))
    polled = await client.poll_device_code(
        device_auth_id="d", user_code="u", interval_s=5
    )
    assert polled.grant is None


async def test_a_404_means_still_waiting_too() -> None:
    client = _client(_replies((404, {})))
    polled = await client.poll_device_code(
        device_auth_id="d", user_code="u", interval_s=5
    )
    assert polled.grant is None


async def test_the_pending_code_in_the_body_also_counts() -> None:
    client = _client(_replies((400, _pending())))
    polled = await client.poll_device_code(
        device_auth_id="d", user_code="u", interval_s=5
    )
    assert polled.grant is None


async def test_a_real_failure_is_rejected_with_the_upstream_words() -> None:
    client = _client(
        _replies((400, {"error": {"message": "已过期", "code": "expired"}}))
    )
    with pytest.raises(LoginRejected, match="已过期"):
        await client.poll_device_code(
            device_auth_id="d", user_code="u", interval_s=5
        )


async def test_a_finished_poll_hands_back_the_servers_verifier() -> None:
    # 本地另造一份 verifier 拿去换，换到的是一条 invalid_grant
    client = _client(_replies((200, GRANT_BODY)))
    polled = await client.poll_device_code(
        device_auth_id="d", user_code="u", interval_s=5
    )
    assert polled.grant is not None
    assert polled.grant.code_verifier == "ver-from-server"


async def test_the_exchange_hop_posts_a_form_not_json() -> None:
    # 这一跳是标准 OAuth，与上面两跳不同口径；顺手统一会让它 415
    seen: list[httpx.Request] = []
    client = _client(
        _recorded(
            seen,
            (200, GRANT_BODY),
            (
                200,
                {
                    "access_token": "at-1",
                    "refresh_token": "rt-1",
                    "expires_in": 3600,
                },
            ),
        )
    )
    polled = await client.poll_device_code(
        device_auth_id="d", user_code="u", interval_s=5
    )
    assert polled.grant is not None
    await client.exchange_code(polled.grant)
    assert (
        seen[1]
        .headers["content-type"]
        .startswith("application/x-www-form-urlencoded")
    )
    assert b"code_verifier=ver-from-server" in seen[1].content


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
    bundle = await client.exchange_code(
        _grant(),
    )
    assert bundle.account_id == "acc-9"
    assert bundle.plan_type == "pro"


async def test_a_token_without_a_lifetime_is_rejected() -> None:
    # 存一份立刻就过期的令牌，等于每次对话都先失败一次再去刷新
    client = _client(
        _replies((200, {"access_token": "at-1", "refresh_token": "rt-1"}))
    )
    with pytest.raises(LoginRejected):
        await client.exchange_code(_grant())


async def test_a_refresh_keeps_the_old_refresh_token() -> None:
    # 上游可能不回新的；当成没有的话，下一次刷新就没东西可用了
    client = _client(
        _replies((200, {"access_token": "at-2", "expires_in": 3600}))
    )
    bundle = await client.refresh("rt-1")
    assert bundle.access_token == "at-2"
    assert bundle.refresh_token == "rt-1"


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
    bundle = await client.exchange_code(_grant())
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
    bundle = await client.exchange_code(_grant())
    assert bundle.plan_type is None


async def test_a_body_that_is_not_json_still_lands_a_sane_error() -> None:
    def html(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="<html>反代插了一段</html>")

    client = _client(httpx.MockTransport(html))
    with pytest.raises(LoginRejected):
        await client.start_device_code()


async def test_a_dead_endpoint_is_unavailable_not_rejected() -> None:
    def blow_up(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    client = _client(httpx.MockTransport(blow_up))
    with pytest.raises(UpstreamUnavailable):
        await client.start_device_code()


async def test_a_dead_endpoint_on_the_poll_hop_is_unavailable_too() -> None:
    def blow_up(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    client = _client(httpx.MockTransport(blow_up))
    with pytest.raises(UpstreamUnavailable):
        await client.poll_device_code(
            device_auth_id="d", user_code="u", interval_s=5
        )


async def test_a_missing_deadline_falls_back_to_a_usable_window() -> None:
    client = _client(_replies((200, {"device_auth_id": "d", "user_code": "u"})))
    started = await client.start_device_code()
    assert started.expires_in_s > 0


async def test_a_garbled_deadline_falls_back_too() -> None:
    client = _client(
        _replies(
            (200, {**START_BODY, "expires_at": "不是时间", "interval": "x"})
        )
    )
    started = await client.start_device_code()
    assert started.expires_in_s > 0
    assert started.interval_s == 5
