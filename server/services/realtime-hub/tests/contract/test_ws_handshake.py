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
from realtime_hub.settings import API_PREFIX
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from lib.auth import JwtCodec

pytestmark = pytest.mark.requires_postgres

WS_PATH = f"{API_PREFIX}/ws"
AUTH_SUBPROTOCOL = "dt.auth"
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
