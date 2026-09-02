"""语音输入 WS 端点的握手契约（testing-standard-python.md §7.1）。

⚠ token 不在 HTTP 头里，鉴权中间件对它不生效，所以不合法的握手必须**单独**
验：没签名头、有签名头但没 `knowledge:use`、没报子协议——每种都要在 accept
之前就被关掉；开关关着要关成可重试的那一档；开着就对一台假 FunASR 走完整程。
"""

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from unit.funasr_fakes import FakeFunAsr, Script

from knowledge_server.app import build_app
from knowledge_server.apps.speech.services.protocol import (
    AUTH_SUBPROTOCOL,
    CLOSE_ASR_UNAVAILABLE,
    CLOSE_UNAUTHENTICATED,
    SPEECH_WS_PATH,
)
from knowledge_server.catalog import KNOWLEDGE_WRITE
from knowledge_server.settings import Settings

HeaderFactory = object

PROTOCOLS = [AUTH_SUBPROTOCOL, "access-token-for-tests"]
PCM = bytes(range(256)) * 8


def _connect(
    client: TestClient,
    headers: dict[str, str],
    protocols: list[str] = PROTOCOLS,
) -> None:
    with client.websocket_connect(
        SPEECH_WS_PATH, subprotocols=protocols, headers=headers
    ):
        pass


def test_no_signed_headers_is_refused_before_accept(
    settings: Settings,
) -> None:
    client = TestClient(build_app(settings))
    with pytest.raises(WebSocketDisconnect) as refused:
        _connect(client, {})
    assert refused.value.code == CLOSE_UNAUTHENTICATED


def test_signed_headers_without_knowledge_use_are_refused(
    settings: Settings, sign: object
) -> None:
    headers = sign((KNOWLEDGE_WRITE,))  # type: ignore[operator]  # 工厂
    client = TestClient(build_app(settings))
    with pytest.raises(WebSocketDisconnect) as refused:
        _connect(client, headers)
    assert refused.value.code == CLOSE_UNAUTHENTICATED


def test_a_handshake_without_the_marker_is_refused(
    settings: Settings, sign: object
) -> None:
    """⚠ 服务端只能回一个客户端报过的子协议；没报 dt.auth 就没法握手。"""
    headers = sign()  # type: ignore[operator]  # 工厂
    client = TestClient(build_app(settings))
    with pytest.raises(WebSocketDisconnect) as refused:
        _connect(client, headers, protocols=[])
    assert refused.value.code == CLOSE_UNAUTHENTICATED


def test_speech_switched_off_closes_retryably(
    settings: Settings, sign: object
) -> None:
    """⚠ 与 1008 分开：没接语音不是「你不该连」，前端据 1013 提示
    「这套部署的语音识别此刻不可用」。"""
    headers = sign()  # type: ignore[operator]  # 工厂
    client = TestClient(build_app(settings))
    with pytest.raises(WebSocketDisconnect) as refused:
        _connect(client, headers)
    assert refused.value.code == CLOSE_ASR_UNAVAILABLE


def test_the_full_round_trip_against_a_fake_funasr(
    settings: Settings, sign: object
) -> None:
    fake = FakeFunAsr(Script(online=("冷", "却水"), offline="冷却水出口温度？"))
    headers = sign()  # type: ignore[operator]  # 工厂
    with fake.threaded() as url:
        wired = settings.model_copy(
            update={"asr_enabled": True, "asr_url": url}
        )
        client = TestClient(build_app(wired))
        with client.websocket_connect(
            SPEECH_WS_PATH, subprotocols=PROTOCOLS, headers=headers
        ) as socket:
            assert socket.accepted_subprotocol == AUTH_SUBPROTOCOL
            # ⚠ ready 之前就送帧：浏览器开麦比中继连 FunASR 快是常态
            socket.send_bytes(PCM)
            assert socket.receive_json() == {"type": "system", "event": "ready"}
            first = socket.receive_json()
            socket.send_bytes(PCM)
            second = socket.receive_json()
            socket.send_json({"action": "stop"})
            final = socket.receive_json()
            done = socket.receive_json()
    assert first == {
        "type": "data",
        "payload": {"stage": "partial", "text": "冷"},
    }
    assert second["payload"] == {"stage": "partial", "text": "冷却水"}
    assert final == {
        "type": "data",
        "payload": {"stage": "final", "text": "冷却水出口温度？"},
    }
    assert done == {"type": "system", "event": "done"}
    assert fake.audio()[0] == PCM
    assert fake.init()["mode"] == "2pass"
