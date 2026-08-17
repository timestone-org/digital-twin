"""客户端 WebSocket 端点。

⚠ 鉴权路径与 HTTP 完全不同：token 走**子协议**，`Authorization` 头上的
中间件对它不生效，闸 1 也认不出它——匿名可达性由边缘免认证 location 保证，
认证在这里完成（testing-standard-python.md §7.1 要求它单独测）。

握手约定：客户端把两个子协议一起报上来

    Sec-WebSocket-Protocol: dt.auth, <access token>

服务端只回 `dt.auth`。⚠ 必须回一个客户端报过的值，否则浏览器判握手失败；
而回 token 本身等于把它写进响应头，会落进代理与浏览器的日志。
"""

import json
import uuid
from typing import Annotated, cast

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect

from lib.logging import get_logger
from lib.utils.timeutils import utcnow
from realtime_hub.apps.channel.deps import get_container
from realtime_hub.apps.channel.errors import UserCodesUnavailable
from realtime_hub.apps.channel.services import (
    AuthenticationRejected,
    Handshake,
)
from realtime_hub.apps.channel.services.session import (
    CLOSE_TOKEN_EXPIRED,
    TYPE_ERROR,
    TYPE_SYSTEM,
)
from realtime_hub.container import Container
from realtime_hub.settings import API_PREFIX

_logger = get_logger("realtime.ws")

router = APIRouter(prefix=API_PREFIX, tags=["realtime"])

# 与 token 一起报上来的子协议标记，服务端回它
AUTH_SUBPROTOCOL = "dt.auth"
# 握手不合法时的关闭码。⚠ 用 1008 而不是 4001：4001 的语义是「票过期了，
# 换一张再来」，而这里是「压根没给票」，客户端的处置完全不同
CLOSE_UNAUTHENTICATED = 1008
# 依赖不可达时的关闭码。⚠ 与 1008 分开：1008 的语义是「你不该连」，客户端据此
# 停止重连；而这里是我们自己查不到权限，它该退避后再来
CLOSE_DEPENDENCY_DOWN = 1013
# 握手要报的两个子协议：标记 + token，缺一不可
SUBPROTOCOL_COUNT = 2


@router.websocket("/ws")
async def channel(
    websocket: WebSocket,
    container: Annotated[Container, Depends(get_container)],
) -> None:
    """一条客户端连接的完整生命周期。

    Args: websocket, container。
    """
    handshake = await _handshake(websocket, container)
    if handshake is None:
        return
    await _serve(websocket, container, handshake)


async def _serve(
    websocket: WebSocket, container: Container, handshake: Handshake
) -> None:
    """登记连接、跑收发循环、无论如何都摘干净。

    ⚠ `finally` 里的摘除不能省：不摘的话反向索引里留着一条已死的连接，
    之后每次扇出都往它上面发一次，而发送会抛在别人的推送路径上。

    Args: websocket, container, handshake。
    """

    async def send(message: dict[str, object]) -> None:
        await websocket.send_json(message)

    session = container.session
    connection = await session.open(handshake, send=send)
    try:
        await _pump(websocket, container, connection_id=connection.id)
    except WebSocketDisconnect:
        pass
    finally:
        await session.close(connection.id)


async def _handshake(
    websocket: WebSocket, container: Container
) -> Handshake | None:
    """验票并接受握手；不合法则在 accept **之前**关掉，返回 None。

    ⚠ 必须在 accept 之前拒绝：accept 之后再关，客户端会先看到「连上了」
    再被踢，重连逻辑会把它当成网络抖动一直重试。

    Args: websocket, container。
    """
    token = _token_from_subprotocols(websocket)
    if token is None:
        await websocket.close(code=CLOSE_UNAUTHENTICATED)
        return None
    try:
        handshake = await container.session.authenticate(token)
    except AuthenticationRejected:
        await websocket.close(code=CLOSE_UNAUTHENTICATED)
        return None
    except UserCodesUnavailable:
        # ⚠ 与「票不对」分开：这是我们自己查不到权限，客户端该过一会儿再连。
        # 混成 1008 的话，一次 auth 抖动会让所有客户端认定自己没权限而不再
        # 重连，于是 auth 恢复了通道也不会自己回来
        await websocket.close(code=CLOSE_DEPENDENCY_DOWN)
        return None
    await websocket.accept(subprotocol=AUTH_SUBPROTOCOL)
    return handshake


async def _pump(
    websocket: WebSocket, container: Container, *, connection_id: uuid.UUID
) -> None:
    """收发循环。

    ⚠ 解不出的 JSON 只回一帧 error，不关连接：一条坏帧不该断掉整条通道。

    Args: websocket, container, connection_id。
    """
    session = container.session
    while True:
        raw = await websocket.receive_text()
        connection = await container.connections.get(connection_id)
        if connection is None:  # pragma: no cover - 摘除与收帧竞争，极窄
            return
        if session.is_expired(connection, now=utcnow()):
            # ⚠ 4001：票过期了，客户端该换票重连，而不是当成网络故障重试
            await websocket.close(code=CLOSE_TOKEN_EXPIRED)
            return
        message = _decode(raw)
        if message is None:
            await connection.send(
                {"type": TYPE_ERROR, "message": "消息不是合法的 JSON 对象"}
            )
            continue
        await session.dispatch(connection, message)
        if session.needs_reauth(connection, now=utcnow()):
            await connection.send(
                {"type": TYPE_SYSTEM, "event": "reauth_required"}
            )


def _token_from_subprotocols(websocket: WebSocket) -> str | None:
    """从 `Sec-WebSocket-Protocol` 里取出 token。

    ⚠ 只认「`dt.auth` 之后的那一个」这种固定形状，不做模糊匹配：把任意看着
    像 token 的子协议都当票收，会让一个拼错的协议名变成静默的鉴权绕过尝试。

    Args: websocket。
    """
    raw = websocket.headers.get("sec-websocket-protocol")
    if not raw:
        return None
    offered = [item.strip() for item in raw.split(",") if item.strip()]
    if len(offered) < SUBPROTOCOL_COUNT or offered[0] != AUTH_SUBPROTOCOL:
        return None
    return offered[1]


def _decode(raw: str) -> dict[str, object] | None:
    """把一帧文本解成动作字典；解不出返回 None。

    Args: raw。
    """
    try:
        message = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(message, dict):
        return None
    return cast("dict[str, object]", message)
