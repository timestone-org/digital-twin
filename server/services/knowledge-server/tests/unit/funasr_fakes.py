"""进程内的假 FunASR：按真服务的握手与帧形状回话，把收到的一切记下来。

剧本驱动：每收到 `every` 帧音频回一段在线增量，收口时回整句。
"""

import asyncio
import json
import threading
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager, contextmanager
from dataclasses import dataclass, field
from typing import cast

from websockets.asyncio.server import Server, ServerConnection, serve
from websockets.exceptions import ConnectionClosed
from websockets.typing import Subprotocol

BINARY = Subprotocol("binary")
ONLINE = "2pass-online"
OFFLINE = "2pass-offline"
START_TIMEOUT_S = 5.0


def frame(mode: str, text: str, *, is_final: bool) -> str:
    """一帧 FunASR 形状的回话。

    Args: mode, text, is_final。
    """
    return json.dumps(
        {"mode": mode, "text": text, "wav_name": "fake", "is_final": is_final}
    )


@dataclass(frozen=True)
class Script:
    """假服务的剧本。"""

    # 每收到 `every` 帧音频回一段在线增量，按序取，取完就不再回
    online: tuple[str, ...] = ()
    every: int = 1
    # 收口时回的整句；`has_final` 为假就装作没有终稿
    offline: str = ""
    has_final: bool = True
    # 收到第 N 帧音频后主动断开，用来演「中途断」
    drop_after: int | None = None


@dataclass
class FakeFunAsr:
    """一台假 FunASR。`messages` 按到达顺序记下收到的每一帧。"""

    script: Script = field(default_factory=Script)
    messages: list[bytes | str] = field(default_factory=list)
    subprotocol: str | None = None

    def init(self) -> dict[str, object]:
        first = next(one for one in self.messages if isinstance(one, str))
        return cast("dict[str, object]", json.loads(first))

    def audio(self) -> list[bytes]:
        return [one for one in self.messages if isinstance(one, bytes)]

    async def handle(self, connection: ServerConnection) -> None:
        """一条连接的剧本。

        Args: connection。
        """
        self.subprotocol = connection.subprotocol
        count = 0
        try:
            async for message in connection:
                self.messages.append(message)
                if isinstance(message, bytes):
                    count += 1
                    if self._should_drop(count):
                        await connection.close()
                        return
                    await self._reply_online(connection, count)
                    continue
                if self._is_end(message) and self.script.has_final:
                    await connection.send(
                        frame(OFFLINE, self.script.offline, is_final=True)
                    )
        except ConnectionClosed:
            return

    def _should_drop(self, count: int) -> bool:
        limit = self.script.drop_after
        return limit is not None and count >= limit

    @staticmethod
    def _is_end(message: str) -> bool:
        parsed = cast("dict[str, object]", json.loads(message))
        return parsed.get("is_speaking") is False

    async def _reply_online(
        self, connection: ServerConnection, count: int
    ) -> None:
        script = self.script
        if count % script.every:
            return
        index = count // script.every - 1
        if index < len(script.online):
            await connection.send(
                frame(ONLINE, script.online[index], is_final=False)
            )

    @asynccontextmanager
    async def serving(self) -> AsyncIterator[str]:
        """在当前事件循环里起服务，给出它的 ws:// 地址。"""
        async with serve(
            self.handle, "127.0.0.1", 0, subprotocols=[BINARY]
        ) as server:
            yield _url_of(server)

    @contextmanager
    def threaded(self) -> Iterator[str]:
        """在自己的线程与事件循环里跑：给同步的 TestClient 用例用。

        ⚠ TestClient 是阻塞调用，与它同一个循环里的假服务永远轮不到回话。
        """
        ready = threading.Event()
        stopping = threading.Event()
        urls: list[str] = []

        def run() -> None:
            asyncio.run(self._serve_until(stopping, ready, urls))

        worker = threading.Thread(target=run, daemon=True)
        worker.start()
        if not ready.wait(START_TIMEOUT_S):
            raise RuntimeError("假 FunASR 没起来")
        try:
            yield urls[0]
        finally:
            stopping.set()
            worker.join(START_TIMEOUT_S)

    async def _serve_until(
        self,
        stopping: threading.Event,
        ready: threading.Event,
        urls: list[str],
    ) -> None:
        async with serve(
            self.handle, "127.0.0.1", 0, subprotocols=[BINARY]
        ) as server:
            urls.append(_url_of(server))
            ready.set()
            await asyncio.get_running_loop().run_in_executor(
                None, stopping.wait
            )


def _url_of(server: Server) -> str:
    port = server.sockets[0].getsockname()[1]
    return f"ws://127.0.0.1:{port}"
