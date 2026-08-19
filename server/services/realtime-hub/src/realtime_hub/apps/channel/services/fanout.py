"""扇出循环：收 Redis 上的消息，发给本副本持有的订阅连接。

⚠ 每个副本都收到全部消息，按主题在本地筛（理由见 settings.fanout_channel）。
⚠ 这是一条**长活的后台任务**：它的生死由 app 的启停钩子管，任务句柄必须存
强引用——`asyncio` 只持弱引用，不存的话任务可能在运行中被 GC 掉，表现是
「推送有时候到不了」，而且没有任何报错。
"""

import asyncio
import contextlib
import json
from collections.abc import Mapping, Sequence
from typing import Any

from lib.cache import PubSub
from lib.logging import get_logger
from realtime_hub.apps.channel.services.connections import (
    Connection,
    ConnectionRegistry,
)

_logger = get_logger("realtime.fanout")


class FanoutListener:
    """订阅扇出频道，把消息发给本副本上订了该主题的连接。"""

    def __init__(
        self, *, pubsub: PubSub, connections: ConnectionRegistry, channel: str
    ) -> None:
        self._pubsub = pubsub
        self._connections = connections
        self._channel = channel
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        """起后台任务。重复调用是幂等的。"""
        if self._task is not None:
            return
        # ⚠ 存强引用，见模块头
        self._task = asyncio.create_task(self._run(), name="realtime-fanout")

    async def stop(self) -> None:
        """停后台任务并等它退出。

        ⚠ 要 await 它退出：直接 cancel 就返回的话，进程可能在 Redis 连接
        还没关干净时就走完关停流程，日志里会留下一条没头没尾的取消异常。
        """
        task = self._task
        if task is None:
            return
        self._task = None
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    async def _run(self) -> None:
        """收发主循环。

        ⚠ 单条消息处理失败只记日志、继续循环：一个坏载荷或一条已死的 socket
        不该让整个副本停止扇出——那会让所有客户端一起静默失联。
        """
        _logger.info("fanout_started", "扇出订阅已建立", channel=self._channel)
        async for _name, envelope in self._pubsub.listen([self._channel]):
            try:
                await self._deliver(envelope)
            except Exception as error:
                _logger.error(
                    "fanout_delivery_failed",
                    "扇出一条消息时失败，已跳过",
                    error_type=type(error).__name__,
                )

    async def _deliver(self, envelope: dict[str, Any]) -> None:
        """把一条信封发给本副本上订了它的连接。

        Args: envelope。
        """
        topic = envelope.get("topic")
        if not isinstance(topic, str):
            _logger.warning(
                "fanout_envelope_without_topic", "信封里没有 topic，已跳过"
            )
            return
        targets = await self._connections.subscribers(topic)
        if not targets:
            return
        # ⚠ 并发发送并**逐条兜住异常**：一条慢或已死的连接不该拖住同主题的
        # 其它订阅者，更不该让这一轮扇出整个失败
        frames = encode_per_name(envelope, topic, targets)
        results = await asyncio.gather(
            *(
                item.send_frame(frames[item.outgoing_topic(topic)])
                for item in targets
            ),
            return_exceptions=True,
        )
        failed = sum(1 for item in results if isinstance(item, BaseException))
        if failed:
            _logger.warning(
                "fanout_partially_delivered",
                "部分连接发送失败，已跳过它们",
                topic=topic,
                targets=len(targets),
                failed=failed,
            )


def encode_per_name(
    envelope: Mapping[str, Any], topic: str, targets: Sequence[Connection]
) -> dict[str, str]:
    """按「这条连接看到的主题名」把信封各编码一次，返回名字 → 已编码的帧。

    ⚠ 一个**名字**编一次，不是一条**连接**编一次：同一份帧最多 500 个条目，
    发给一面墙上的二十块屏，逐条 `send_json` 就是同一段 JSON 序列化二十遍。
    ⚠ 但也不能全场只编一次：匿名连接订的是它自己那张票的别名，而信封上写的
    是真主题。不改名的话客户端按别名登记的处理器一条也匹配不上——连着、有
    数据、屏上全空——而且真主题就这么随帧出门了（`GrantedTopic`）。
    ⚠ 编码口径与 `WebSocket.send_json` 逐字一致（`separators=(",", ":")`、
    转义非 ASCII）：改它就是改线上帧的字节，而这一层只该省掉重复的序列化。

    Args: envelope, topic（信封上的真主题）, targets。
    """
    frames: dict[str, str] = {}
    for connection in targets:
        name = connection.outgoing_topic(topic)
        if name not in frames:
            frames[name] = json.dumps(
                {**envelope, "topic": name}, separators=(",", ":")
            )
    return frames
