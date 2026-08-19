"""客户端 WebSocket 端点。

⚠ 鉴权路径与 HTTP 完全不同：凭据走**子协议**，`Authorization` 头上的
中间件对它不生效，闸 1 也认不出它——匿名可达性由边缘免认证 location 保证，
认证在这里完成（testing-standard-python.md §7.1 要求它单独测）。

握手约定：客户端把两个子协议一起报上来，第一个是标记、第二个是凭据

    Sec-WebSocket-Protocol: dt.auth, <access token>      ← 登录态
    Sec-WebSocket-Protocol: dt.public, <公开票据>        ← 公开链接（ADR-0021）

服务端**回客户端报过的那个标记**。⚠ 必须回一个客户端报过的值，否则浏览器判
握手失败；而回凭据本身等于把它写进响应头，会落进代理与浏览器的日志。
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
    AnonymousQuotaExceeded,
    AuthenticationRejected,
    Handshake,
    PublicGrantRejected,
)
from realtime_hub.apps.channel.services.session import (
    CLOSE_ANONYMOUS_QUOTA,
    CLOSE_PUBLIC_GRANT_REVOKED,
    CLOSE_TOKEN_EXPIRED,
    TYPE_ERROR,
    TYPE_SYSTEM,
    is_expired,
    needs_reauth,
)
from realtime_hub.container import Container
from realtime_hub.settings import API_PREFIX

_logger = get_logger("realtime.ws")

router = APIRouter(prefix=API_PREFIX, tags=["realtime"])

# 与 access token 一起报上来的子协议标记，服务端回它
AUTH_SUBPROTOCOL = "dt.auth"
# 与公开票据一起报上来的子协议标记。⚠ 与上面分成两个而不是「先当 token 试、
# 不行再当票据试」：试探式的鉴权会让一次形状变化静默地走进另一条路径
PUBLIC_SUBPROTOCOL = "dt.public"
SUBPROTOCOL_MARKERS = (AUTH_SUBPROTOCOL, PUBLIC_SUBPROTOCOL)
# 握手不合法时的关闭码。⚠ 用 1008 而不是 4001：4001 的语义是「票过期了，
# 换一张再来」，而这里是「压根没给票」，客户端的处置完全不同
CLOSE_UNAUTHENTICATED = 1008
# 依赖不可达时的关闭码。⚠ 与 1008 分开：1008 的语义是「你不该连」，客户端据此
# 停止重连；而这里是我们自己查不到权限，它该退避后再来
CLOSE_DEPENDENCY_DOWN = 1013
# 握手要报的两个子协议：标记 + 凭据，缺一不可
SUBPROTOCOL_COUNT = 2


@router.websocket("/ws")
async def channel(
    websocket: WebSocket,
    container: Annotated[Container, Depends(get_container)],
) -> None:
    """一条客户端连接的完整生命周期。

    Args: websocket, container。
    """
    accepted = await _handshake(websocket, container)
    if accepted is None:
        return
    await _serve(websocket, container, accepted)


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

    async def send_frame(frame: str) -> None:
        # ⚠ 数据帧已经在扇出那一层编码过了，这里只负责发出去：再走一次
        # `send_json` 就等于把同一段 JSON 序列化两遍
        await websocket.send_text(frame)

    session = container.session
    try:
        connection = await session.open(
            handshake, send=send, send_frame=send_frame
        )
    except AnonymousQuotaExceeded:  # pragma: no cover - 并发抢名额的窄窗口
        # ⚠ 名额在 accept 之前已经问过一次，走到这里的是两条并发握手抢同一个
        # 名额那个窄窗口——驱动不出来，但漏了它就是一次未捕获异常。关闭码仍用
        # 可重试的那一档
        await websocket.close(code=CLOSE_ANONYMOUS_QUOTA)
        return
    # 复核任务要能主动断掉授权已被撤回的匿名连接，而它手上只有连接对象
    connection.close = lambda code: websocket.close(code=code)
    try:
        await _pump(websocket, container, connection_id=connection.id)
    except WebSocketDisconnect:
        pass
    finally:
        await session.close(connection.id)


async def _handshake(
    websocket: WebSocket, container: Container
) -> Handshake | None:
    """验凭据并接受握手；不合法则在 accept **之前**关掉，返回 None。

    ⚠ 必须在 accept 之前拒绝：accept 之后再关，客户端会先看到「连上了」
    再被踢——它的退避会在 open 那一刻归零，于是变成每秒一次的空转重连。
    名额也因此要在这里问，而不是等到登记那一步。

    Args: websocket, container。
    """
    offered = _credential_from_subprotocols(websocket)
    if offered is None:
        await websocket.close(code=CLOSE_UNAUTHENTICATED)
        return None
    marker, credential = offered
    handshake = await _authenticate(websocket, container, marker, credential)
    if handshake is None:
        return None
    if not await container.session.has_room(handshake):
        await websocket.close(code=CLOSE_ANONYMOUS_QUOTA)
        return None
    await websocket.accept(subprotocol=marker)
    return handshake


async def _authenticate(
    websocket: WebSocket, container: Container, marker: str, credential: str
) -> Handshake | None:
    """按标记走对应的那条验证路径；不通过则关掉连接并返回 None。

    Args: websocket, container, marker, credential。
    """
    session = container.session
    try:
        if marker == PUBLIC_SUBPROTOCOL:
            return await session.authenticate_public(credential)
        return await session.authenticate(credential)
    except AuthenticationRejected:
        await websocket.close(code=CLOSE_UNAUTHENTICATED)
    except PublicGrantRejected:
        # ⚠ 与 1008 分开：撤回与「推送方还没对账到这枚新票据」在这里长得一样，
        # 而后者只要等一轮对账。合成 1008 会让刚发布的链接被客户端判成永久失败
        await websocket.close(code=CLOSE_PUBLIC_GRANT_REVOKED)
    except UserCodesUnavailable:
        # ⚠ 与「票不对」分开：这是我们自己查不到权限，客户端该过一会儿再连。
        # 混成 1008 的话，一次 auth 抖动会让所有客户端认定自己没权限而不再
        # 重连，于是 auth 恢复了通道也不会自己回来
        await websocket.close(code=CLOSE_DEPENDENCY_DOWN)
    return None


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
        if is_expired(connection, now=utcnow()):
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
        if needs_reauth(connection, now=utcnow()):
            await connection.send(
                {"type": TYPE_SYSTEM, "event": "reauth_required"}
            )


def _credential_from_subprotocols(
    websocket: WebSocket,
) -> tuple[str, str] | None:
    """从 `Sec-WebSocket-Protocol` 里取出「标记 + 凭据」。

    ⚠ 只认「标记之后的那一个」这种固定形状，不做模糊匹配：把任意看着像凭据
    的子协议都当票收，会让一个拼错的协议名变成静默的鉴权绕过尝试。

    Args: websocket。
    """
    raw = websocket.headers.get("sec-websocket-protocol")
    if not raw:
        return None
    offered = [item.strip() for item in raw.split(",") if item.strip()]
    if len(offered) < SUBPROTOCOL_COUNT:
        return None
    marker = offered[0]
    if marker not in SUBPROTOCOL_MARKERS:
        return None
    return marker, offered[1]


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
