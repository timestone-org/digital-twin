"""Redis 发布订阅：把一条消息扇给所有监听该频道的进程。

用于「同一份消息要发给分布在多个副本上的持有者」这类场景。

⚠ 它是**即发即弃**的：没有持久化、没有补发、没有投递保证。订阅方断开期间
发出的消息就是丢了。要「不许丢」的场景不能用它——那需要队列，不是这里。
⚠ 也**没有顺序保证**跨频道成立。要序号的消费方必须自己带序号，不能靠到达
顺序推断。
"""

# ⚠ 整份文件关掉这两条 pyright 规则，而不是逐行贴 pragma：redis-py 的
# `pubsub()` / `get_message()` 在它自己的类型里就是部分未知的，逐行抑制会让
# 这个不足百行的适配器里有一半是 pragma，且行长与 black 的换行反复打架。
# 本文件的**全部职责**就是把这个未类型化的 API 包成一个有类型的窄面——
# 未知类型止步于此，`listen()` 与 `publish()` 的对外签名是完全具体的。
# pyright: reportUnknownMemberType=false, reportUnknownVariableType=false

import json
from collections.abc import AsyncIterator, Sequence
from typing import Any, cast

from redis.asyncio import Redis
from redis.asyncio.client import PubSub as RedisPubSub
from redis.exceptions import RedisError

from lib.errors.base import DependencyUnavailable
from lib.logging.context import current_log_context
from lib.logging.logger import get_logger

_logger = get_logger("lib.pubsub")

# 订阅侧每次等消息的上限。⚠ 不能设成 None（永久阻塞）：那样取消这个任务时
# 它卡在 C 层的读上，关停会挂到超时才结束
_POLL_TIMEOUT_S = 1.0

# W3C traceparent 的版本与采样标志位。⚠ 采样恒为 01：这条通道上的消息量由
# 推送方的合并窗口控制，而链路断在异步处是最难查的一类问题，不值得为省一点
# 日志量换它
_TRACE_VERSION = "00"
_TRACE_FLAGS = "01"
# 信封里承载 trace 的键名，与 api-contract §10 的消息契约同名
TRACEPARENT_KEY = "traceparent"


class PubSub:
    """一个 Redis 连接上的发布订阅面。"""

    def __init__(self, *, url: str, timeout_s: float = 1.0) -> None:
        self._client: Redis = Redis.from_url(
            url,
            decode_responses=True,
            socket_timeout=timeout_s,
            socket_connect_timeout=timeout_s,
        )

    async def publish(self, channel: str, payload: dict[str, Any]) -> int:
        """往频道发一条消息，返回收到它的订阅者数。

        ⚠ 返回 0 不是错误：可能确实没人在听。调用方要据它判断「该不该有人
        在听」时，得自己有别的依据——Redis 只数当前连着的订阅者。

        ⚠ 信封里必须带 `traceparent`：pub/sub 是跨进程的异步交接，
        contextvars 传不过去。不带它，链路就在这里齐断：发送侧握着一条完整
        的调用链，而订阅方那边只剩一段无根的日志。

        Args: channel, payload。
        """
        envelope = {**payload, TRACEPARENT_KEY: _traceparent()}
        try:
            sent = await self._client.publish(channel, json.dumps(envelope))
            return int(sent)
        except RedisError as error:
            raise DependencyUnavailable(
                "缓存服务暂时不可用",
                context={"dependency": "redis"},
            ) from error

    async def listen(
        self, channels: Sequence[str]
    ) -> AsyncIterator[tuple[str, dict[str, Any]]]:
        """订阅若干频道并逐条产出 `(频道, 载荷)`。

        ⚠ 解不出来的载荷**跳过并记一条日志**，不抛：一条坏消息不该让整条
        订阅循环退出，那会让该副本上所有连接一起停止收数据。

        Args: channels。
        """
        pubsub = self._open()
        try:
            await pubsub.subscribe(*channels)
            while True:
                message = await self._next(pubsub)
                if message is None:
                    continue
                decoded = _decode(message)
                if decoded is not None:
                    yield decoded
        except RedisError as error:
            raise DependencyUnavailable(
                "缓存服务暂时不可用",
                context={"dependency": "redis"},
            ) from error
        finally:
            await pubsub.aclose()

    def _open(self) -> RedisPubSub:
        """开一个订阅面。

        抑制见文件头。
        """
        handle: RedisPubSub = self._client.pubsub()
        return handle

    @staticmethod
    async def _next(pubsub: RedisPubSub) -> object:
        """等下一条消息；超时返回 None。

        Args: pubsub。
        """
        message: object = await pubsub.get_message(
            ignore_subscribe_messages=True, timeout=_POLL_TIMEOUT_S
        )
        return message

    async def close(self) -> None:
        """关闭连接。"""
        await self._client.aclose()


def _decode(message: object) -> tuple[str, dict[str, Any]] | None:
    """把 redis-py 的消息字典解成 `(频道, 载荷)`；解不出返回 None。

    Args: message。
    """
    if not isinstance(message, dict):
        return None
    fields = cast("dict[str, object]", message)
    channel = fields.get("channel")
    raw = fields.get("data")
    if not isinstance(channel, str) or not isinstance(raw, str):
        return None
    try:
        decoded = cast("object", json.loads(raw))
    except json.JSONDecodeError:
        _logger.warning(
            "pubsub_payload_undecodable", "载荷不是合法 JSON，已跳过"
        )
        return None
    if not isinstance(decoded, dict):
        _logger.warning(
            "pubsub_payload_not_object", "载荷不是 JSON 对象，已跳过"
        )
        return None
    return channel, cast("dict[str, Any]", decoded)


def _traceparent() -> str:
    """把当前日志上下文压成一条 W3C traceparent。

    ⚠ 没有 trace_id 时给全零：格式上仍然合法，订阅方照常解析，而「全零」
    本身就说明发送侧没有链路——比不带这个键更好查。
    """
    context = current_log_context()
    trace_id = (context.trace_id or "").replace("-", "").rjust(32, "0")[:32]
    span_id = (context.span_id or "").replace("-", "").rjust(16, "0")[:16]
    return f"{_TRACE_VERSION}-{trace_id}-{span_id}-{_TRACE_FLAGS}"
