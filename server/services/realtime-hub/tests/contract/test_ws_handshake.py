"""WS 握手的鉴权契约（testing-standard-python.md §7.1）。

⚠ 这条路径与 HTTP 完全不同：token 在**子协议**里，`Authorization` 头上的
鉴权中间件对它不生效，闸 1 也认不出它。所以它必须单独测——单元层验的是
`authenticate()` 这个函数，这里验的是**真实握手**：不合法的票有没有在
accept 之前就被关掉。
"""

import base64
import json

import pytest
from fastapi import FastAPI
from realtime_hub.apps.channel.services import ticket_fingerprint
from realtime_hub.apps.channel.services.session import (
    CLOSE_ANONYMOUS_QUOTA,
    CLOSE_PUBLIC_GRANT_REVOKED,
)
from realtime_hub.settings import API_PREFIX, INTERNAL_PREFIX, Settings
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from lib.auth import JwtCodec

pytestmark = pytest.mark.requires_postgres

WS_PATH = f"{API_PREFIX}/ws"
AUTH_SUBPROTOCOL = "dt.auth"
# 公开链接那条路的标记，凭据是票据不是令牌（ADR-0021）
PUBLIC_SUBPROTOCOL = "dt.public"
PUBLIC_TICKET = "public-ticket-for-tests"
PUBLIC_TOPIC = "opcua:9f8e7d6c"
# 握手不合法的关闭码。⚠ 与「票过期」的 4001 分开，客户端的处置完全不同
CLOSE_UNAUTHENTICATED = 1008


def _connect(client: TestClient, *protocols: str) -> None:
    with client.websocket_connect(WS_PATH, subprotocols=list(protocols)):
        pass


def test_a_valid_token_completes_the_handshake(
    application: FastAPI, token: object
) -> None:
    protocols = [AUTH_SUBPROTOCOL, token()]  # type: ignore[operator]  # 工厂
    with (
        TestClient(application) as client,
        client.websocket_connect(WS_PATH, subprotocols=protocols) as socket,
    ):
        hello = socket.receive_json()
    assert hello["type"] == "system"
    assert hello["event"] == "connected"
    # ⚠ 明确告知何时换票，客户端不必自己解 token 猜
    assert "reauth_before" in hello


def test_no_subprotocol_at_all_is_refused(application: FastAPI) -> None:
    with (
        TestClient(application) as client,
        pytest.raises(WebSocketDisconnect) as refused,
    ):
        _connect(client)
    assert refused.value.code == CLOSE_UNAUTHENTICATED


def test_the_marker_alone_without_a_token_is_refused(
    application: FastAPI,
) -> None:
    with (
        TestClient(application) as client,
        pytest.raises(WebSocketDisconnect) as refused,
    ):
        _connect(client, AUTH_SUBPROTOCOL)
    assert refused.value.code == CLOSE_UNAUTHENTICATED


def test_a_token_without_the_marker_is_refused(
    application: FastAPI, token: object
) -> None:
    # ⚠ 只认「dt.auth 之后的那一个」这种固定形状：把任意看着像 token 的
    # 子协议都当票收，会让一个拼错的协议名变成静默的鉴权绕过尝试
    with (
        TestClient(application) as client,
        pytest.raises(WebSocketDisconnect) as refused,
    ):
        _connect(client, token())  # type: ignore[operator]  # 同上
    assert refused.value.code == CLOSE_UNAUTHENTICATED


def test_an_expired_token_is_refused(
    application: FastAPI, expired_token: str
) -> None:
    with (
        TestClient(application) as client,
        pytest.raises(WebSocketDisconnect) as refused,
    ):
        _connect(client, AUTH_SUBPROTOCOL, expired_token)
    assert refused.value.code == CLOSE_UNAUTHENTICATED


def test_a_forged_signature_is_refused(application: FastAPI) -> None:
    forged = JwtCodec(
        signing_key="forged-secret-0123456789abcdefgh",
        verification_keys=("forged-secret-0123456789abcdefgh",),
        issuer="auth-server",
    )
    raw, _claims = forged.issue(
        subject="3fa85f64-5717-4562-b3fc-2c963f66afa6",
        token_type="access",
        ttl_s=900,
    )
    with (
        TestClient(application) as client,
        pytest.raises(WebSocketDisconnect) as refused,
    ):
        _connect(client, AUTH_SUBPROTOCOL, raw)
    assert refused.value.code == CLOSE_UNAUTHENTICATED


def test_the_alg_none_trick_is_refused(application: FastAPI) -> None:
    """⚠ 算法混淆：把 alg 改成 none 并去掉签名段。

    库若按令牌自报的 alg 去验，这枚票就无签名通过——这是 JWT 最经典的一处
    绕过，必须有专门用例钉死。
    """
    header = _b64({"alg": "none", "typ": "JWT"})
    payload = _b64(
        {
            "sub": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
            "type": "access",
            "exp": 9999999999,
            "iat": 1,
            "jti": "x",
            "iss": "auth-server",
        }
    )
    with (
        TestClient(application) as client,
        pytest.raises(WebSocketDisconnect) as refused,
    ):
        _connect(client, AUTH_SUBPROTOCOL, f"{header}.{payload}.")
    assert refused.value.code == CLOSE_UNAUTHENTICATED


def _b64(payload: dict[str, object]) -> str:
    raw = json.dumps(payload, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _grant(client: TestClient, service_key: str) -> None:
    """给 `PUBLIC_TICKET` 登记「能订 PUBLIC_TOPIC」的匿名授权，主题一并登记。

    ⚠ 走内部端点而不是直接调 container：容器里的库连接属于 TestClient 那条
    事件循环，在用例自己的循环里碰它会以「Future attached to a different
    loop」炸在启动阶段——而报出来的位置与真正的原因隔得极远。

    Args: client, service_key。
    """
    headers = {"X-Service-Key": service_key}
    declared = client.post(
        f"{INTERNAL_PREFIX}/realtime/topics",
        json={
            "topic": PUBLIC_TOPIC,
            "required_code": "opcua:view",
            "publisher": "tests",
        },
        headers=headers,
    )
    granted = client.post(
        f"{INTERNAL_PREFIX}/realtime/public-grants",
        json={
            "ticket_hash": ticket_fingerprint(PUBLIC_TICKET),
            "topic": PUBLIC_TOPIC,
            "publisher": "tests",
        },
        headers=headers,
    )
    assert (declared.status_code, granted.status_code) == (200, 200)


@pytest.mark.usefixtures("_clean")
def test_a_granted_public_ticket_completes_the_handshake(
    application: FastAPI, settings: Settings
) -> None:
    protocols = [PUBLIC_SUBPROTOCOL, PUBLIC_TICKET]
    with TestClient(application) as client:
        _grant(client, settings.edge_service_key.get_secret_value())
        with client.websocket_connect(
            WS_PATH, subprotocols=protocols
        ) as socket:
            hello = socket.receive_json()
            # ⚠ 服务端必须回客户端报过的那个标记，否则浏览器判握手失败
            assert socket.accepted_subprotocol == PUBLIC_SUBPROTOCOL
            socket.send_json(
                {
                    "action": "subscribe",
                    "topic": f"public:{PUBLIC_TICKET}",
                    "req_id": "r1",
                }
            )
            ack = socket.receive_json()
    assert hello["event"] == "connected"
    assert ack["type"] == "ack"


@pytest.mark.usefixtures("_clean")
def test_an_unknown_public_ticket_is_refused_but_retryably(
    application: FastAPI,
) -> None:
    # ⚠ 与 1008 分开：撤回与「推送方还没对账到这枚新票据」长得一样，而后者只
    # 要等一轮对账——合成 1008 会让刚发布的链接被客户端判成永久失败
    with (
        TestClient(application) as client,
        pytest.raises(WebSocketDisconnect) as refused,
    ):
        _connect(client, PUBLIC_SUBPROTOCOL, "never-granted-ticket")
    assert refused.value.code == CLOSE_PUBLIC_GRANT_REVOKED


@pytest.mark.usefixtures("_clean")
def test_a_public_ticket_cannot_subscribe_the_real_topic(
    application: FastAPI, settings: Settings
) -> None:
    protocols = [PUBLIC_SUBPROTOCOL, PUBLIC_TICKET]
    with TestClient(application) as client:
        _grant(client, settings.edge_service_key.get_secret_value())
        with client.websocket_connect(
            WS_PATH, subprotocols=protocols
        ) as socket:
            socket.receive_json()
            socket.send_json(
                {"action": "subscribe", "topic": PUBLIC_TOPIC, "req_id": "r1"}
            )
            denied = socket.receive_json()
    # 匿名连接只说得出自己那个别名，真主题一个字都不出门
    assert denied["type"] == "error"


@pytest.mark.usefixtures("_clean")
def test_a_ticket_past_its_quota_is_turned_away_retryably(
    crowded_application: FastAPI, settings: Settings
) -> None:
    # ⚠ 一枚泄露的公开令牌不许把连接池吃满（ADR-0014 §四 点名的三件事之一）。
    # 关闭码用可重试的那一档：拥挤不是拒绝
    protocols = [PUBLIC_SUBPROTOCOL, PUBLIC_TICKET]
    with TestClient(crowded_application) as client:
        _grant(client, settings.edge_service_key.get_secret_value())
        with (
            client.websocket_connect(WS_PATH, subprotocols=protocols),
            pytest.raises(WebSocketDisconnect) as refused,
        ):
            _connect(client, *protocols)
    assert refused.value.code == CLOSE_ANONYMOUS_QUOTA
