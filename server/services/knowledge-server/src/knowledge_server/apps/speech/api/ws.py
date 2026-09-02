"""语音输入的 WebSocket 端点：握手认人、开关判定、把连接交给中继。

⚠ 鉴权路径与 HTTP 不同：token 走子协议，边缘用 `/_auth_ws` 把它映射成
`Authorization` 去问 auth-server，再注入 X-Auth-* 签名头——本端点读的仍是那组
签名头，一行 JWT 代码都没有（同 `deps.py` 的口径）。不合法的握手在 accept
**之前**关掉：accept 之后再关，客户端的退避会在 open 那一刻归零，变成空转重连。
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, WebSocket

from knowledge_server.apps.speech.api.adapter import StarletteSocket
from knowledge_server.apps.speech.services.bridge import (
    AsrLeg,
    OpenLeg,
    RelayLimits,
    relay,
)
from knowledge_server.apps.speech.services.funasr import FunAsrConfig, open_leg
from knowledge_server.apps.speech.services.protocol import (
    AUTH_SUBPROTOCOL,
    CLOSE_ASR_UNAVAILABLE,
    CLOSE_UNAUTHENTICATED,
    SPEECH_WS_PATH,
)
from knowledge_server.catalog import KNOWLEDGE_USE
from knowledge_server.container import Container
from knowledge_server.deps import get_container
from knowledge_server.settings import Settings
from lib.auth import CallerContext, decode_caller
from lib.logging import get_logger
from lib.utils.timeutils import utcnow

_logger = get_logger("knowledge.speech.ws")

router = APIRouter(tags=["speech"])

# 与检索同一个码：能问就能用嘴问
REQUIRED = frozenset({KNOWLEDGE_USE})


@router.websocket(SPEECH_WS_PATH)
async def speech(
    websocket: WebSocket,
    container: Annotated[Container, Depends(get_container)],
) -> None:
    """一条语音输入连接的完整生命周期。

    Args: websocket, container。
    """
    settings = container.settings
    caller = _authenticate(websocket, settings)
    if caller is None:
        await websocket.close(code=CLOSE_UNAUTHENTICATED)
        return
    if not settings.asr_enabled:
        await websocket.close(code=CLOSE_ASR_UNAVAILABLE)
        return
    await websocket.accept(subprotocol=AUTH_SUBPROTOCOL)
    await _serve(websocket, settings, caller)


def _authenticate(
    websocket: WebSocket, settings: Settings
) -> CallerContext | None:
    """验签名头、验权限码；不通过给 None 并记下卡在哪一步。

    Args: websocket, settings。
    """
    if not _offers_marker(websocket):
        _logger.info("speech_handshake_rejected", "没报 dt.auth 子协议")
        return None
    outcome = decode_caller(
        websocket.headers,
        signing_secret=settings.edge_signing_secret.get_secret_value(),
        now=utcnow(),
    )
    if outcome.caller is None:
        _logger.info(
            "speech_handshake_rejected", "身份头不可信", reason=outcome.reason
        )
        return None
    if not outcome.caller.has_all(REQUIRED):
        _logger.info(
            "speech_handshake_rejected",
            "没有 knowledge:use",
            user_id=str(outcome.caller.user_id),
        )
        return None
    return outcome.caller


def _offers_marker(websocket: WebSocket) -> bool:
    """客户端报的第一个子协议是不是 `dt.auth`。

    ⚠ 服务端只能回一个客户端报过的值，否则浏览器判握手失败；边缘也只把
    这个形状里的 token 映射成 Authorization。

    Args: websocket。
    """
    raw = websocket.headers.get("sec-websocket-protocol", "")
    offered = [item.strip() for item in raw.split(",") if item.strip()]
    return bool(offered) and offered[0] == AUTH_SUBPROTOCOL


async def _serve(
    websocket: WebSocket, settings: Settings, caller: CallerContext
) -> None:
    user_id = str(caller.user_id)
    _logger.info("speech_session_opened", user_id=user_id)
    await relay(
        StarletteSocket(websocket), _leg_opener(settings), _limits(settings)
    )
    _logger.info("speech_session_closed", user_id=user_id)


def _leg_opener(settings: Settings) -> OpenLeg:
    """按配置造出「连一次 FunASR」的动作；wav_name 一条连接一个。

    Args: settings。
    """
    config = FunAsrConfig(
        url=settings.asr_url,
        hotwords=settings.asr_hotwords,
        connect_timeout_s=settings.asr_connect_timeout_s,
        tail_silence_s=settings.asr_tail_silence_s,
    )
    wav_name = f"dt-{uuid.uuid4().hex[:8]}"

    async def opener() -> AsrLeg:
        return await open_leg(config, wav_name=wav_name)

    return opener


def _limits(settings: Settings) -> RelayLimits:
    return RelayLimits(
        final_timeout_s=settings.asr_final_timeout_s,
        idle_timeout_s=settings.asr_idle_timeout_s,
        max_utterance_s=settings.asr_max_utterance_s,
    )
