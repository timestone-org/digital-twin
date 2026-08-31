"""连接被取消掉时，摘除还跑不跑得完。

⚠ 这一条单独存在，是因为契约层看不见它：真实握手那批用例里，摘除跑没跑完
都不影响断言，漏掉时唯一的痕迹是库里留下一行永远不会有人来收的订阅——而
扇出仍然会按主题找到它。
"""

import asyncio
import uuid
from datetime import timedelta
from typing import Any, cast

import anyio
from fastapi import WebSocket
from realtime_hub.apps.channel.api.ws import _serve
from realtime_hub.apps.channel.services import Connection, Handshake
from realtime_hub.container import Container

from lib.utils.timeutils import utcnow

# 等 shield 那一步跑完最多让出几次调度
_SCHEDULER_TURNS = 10


class SlowSession:
    """摘除要过一次 await 才做完的会话，替下真的 SessionService。

    ⚠ 那次 await 是关键：取消在挂起点送达，而摘除但凡碰一次库（真实现要清
    订阅行）就会挂起一次——没有 shield 的话它就断在那里。
    """

    def __init__(self) -> None:
        self.closed: list[uuid.UUID] = []

    async def open(
        self, handshake: Handshake, *, send: Any, send_frame: Any
    ) -> Connection:
        return Connection(
            id=uuid.uuid4(),
            user_id=handshake.user_id,
            codes=handshake.codes,
            expires_at=handshake.expires_at,
            checked_at=utcnow(),
            send=send,
            send_frame=send_frame,
        )

    async def close(self, connection_id: uuid.UUID) -> None:
        await asyncio.sleep(0)
        self.closed.append(connection_id)


class SilentSocket:
    """永远收不到下一帧的连接——用例要的是「停在收帧那一步再被取消」。

    ⚠ 只有 `receive_text`：这条路径上发帧与关连接都没人调，补出来的空方法
    只会让人以为它们参与了断言。
    """

    async def receive_text(self) -> str:
        await asyncio.Event().wait()
        raise AssertionError("到不了这里")  # pragma: no cover - 上一行不返回


def _handshake() -> Handshake:
    return Handshake(
        user_id=uuid.uuid4(),
        codes=frozenset({"opcua:view"}),
        expires_at=utcnow() + timedelta(minutes=15),
    )


async def test_a_cancelled_connection_still_gets_swept() -> None:
    """⚠ 取消必须用 anyio 的取消域，不能只 `task.cancel()`。

    `task.cancel()` 只送一次，`finally` 里之后的 await 照常跑得完，用例于是
    怎么写都绿；而真实的取消来自取消域（服务器的任务组、关停），它在**每个**
    挂起点重新送达——摘除的第一个 await 就断在那里。
    """
    session = SlowSession()
    container = cast("Container", type("C", (), {"session": session})())

    with anyio.move_on_after(0.01):
        await _serve(cast("WebSocket", SilentSocket()), container, _handshake())

    # shield 里那一步是另起的任务，给它一次调度
    for _ in range(_SCHEDULER_TURNS):
        if session.closed:
            break
        await asyncio.sleep(0)
    assert len(session.closed) == 1
