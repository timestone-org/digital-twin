"""把 Starlette 的 WebSocket 包成中继要的 `BrowserSocket`：收一帧、发一帧、关。

浏览器断了的各种样子（disconnect 消息、发送时的 OSError、关后再发的
RuntimeError）在这里统一翻成 `BrowserGone`，编排层只认这一种。
"""

import asyncio

from fastapi import WebSocket, WebSocketDisconnect

from knowledge_server.apps.speech.services.bridge import (
    BrowserGone,
    ClientFrame,
)

DISCONNECT = "websocket.disconnect"
# 往浏览器发一帧最多等多久
SEND_TIMEOUT_S = 5.0


class StarletteSocket:
    """一条已 accept 的 Starlette WebSocket。"""

    def __init__(self, websocket: WebSocket) -> None:
        self._websocket = websocket

    async def receive(self) -> ClientFrame:
        """收一帧：二进制原样给、文本原样给。"""
        try:
            message = await self._websocket.receive()
        except RuntimeError as error:
            raise BrowserGone from error
        if message["type"] == DISCONNECT:
            raise BrowserGone
        data = message.get("bytes")
        if isinstance(data, bytes):
            return data
        text = message.get("text")
        return text if isinstance(text, str) else ""

    async def send_json(self, message: dict[str, object]) -> None:
        """发一帧信封。

        Args: message。
        """
        try:
            # ⚠ 浏览器假死时发送会挂在背压上：等不到就当它走了，别把中继挂住
            async with asyncio.timeout(SEND_TIMEOUT_S):
                await self._websocket.send_json(message)
        except (WebSocketDisconnect, RuntimeError, TimeoutError) as error:
            raise BrowserGone from error

    async def close(self, code: int) -> None:
        """关连接。

        Args: code。
        """
        try:
            await self._websocket.close(code=code)
        except (WebSocketDisconnect, RuntimeError) as error:
            raise BrowserGone from error
