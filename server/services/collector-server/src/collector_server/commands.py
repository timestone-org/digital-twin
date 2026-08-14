"""命令总线的传输面：Redis list 做的一问一答。

请求进 `collect:cmd:req`，应答进 `collect:cmd:reply:{request_id}`。
零业务逻辑——载荷怎么解释归 `apps/collect/bus/consumer.py`。
"""

import json
from collections.abc import Mapping, Sequence
from typing import Any, Protocol, cast

from redis.asyncio import Redis
from redis.exceptions import RedisError

from lib.errors import DependencyUnavailable
from lib.logging import get_logger
from lib.logging.context import current_log_context

_logger = get_logger("collect.commands")

REQUEST_KEY = "collect:cmd:req"
REPLY_PREFIX = "collect:cmd:reply"

# ⚠ 阻塞取请求的连接不能用 1s 的 socket 超时：BRPOP 阻塞满一拍就会被驱动层
# 判成读超时抛出来。socket 超时必须比阻塞时长再宽一点
BLOCK_SOCKET_MARGIN_S = 5.0

# W3C traceparent 的版本与采样标志位
_TRACE_VERSION = "00"
_TRACE_FLAGS = "01"
# 信封里承载链路的键名，与 api-contract §10 的消息契约同名
TRACEPARENT_KEY = "traceparent"
# BRPOP 回包里 `(键名, 内容)` 这一对的长度
_PAIR = 2


def reply_key(request_id: str) -> str:
    """一次请求的应答键。

    Args: request_id。
    """
    return f"{REPLY_PREFIX}:{request_id}"


def current_traceparent() -> str:
    """把当前日志上下文压成一条 W3C traceparent。

    ⚠ 队列/总线不会自动传播链路：信封里漏了它，链路就在异步处齐断——一边
    握着完整调用链，另一边只剩一段无根的日志。

    """
    context = current_log_context()
    trace_id = (context.trace_id or "").replace("-", "").rjust(32, "0")[:32]
    span_id = (context.span_id or "").replace("-", "").rjust(16, "0")[:16]
    return f"{_TRACE_VERSION}-{trace_id}-{span_id}-{_TRACE_FLAGS}"


class CommandTransport(Protocol):
    """命令总线的最小面。真实现打 Redis，测试用进程内假件。"""

    async def take(self, *, block_s: float) -> dict[str, Any] | None: ...

    async def reply(
        self, request_id: str, payload: Mapping[str, Any], *, ttl_s: int
    ) -> None: ...

    async def close(self) -> None: ...


class RedisCommandTransport:
    """Redis list 实现。"""

    def __init__(self, *, url: str, block_s: float) -> None:
        """按连接串初始化。

        Args: url, block_s（一次阻塞取请求的时长）。
        """
        # pyright: ignore 的理由 —— redis-py 的 from_url 形参标成 Unknown
        self._client: Redis = (
            Redis.from_url(  # pyright: ignore[reportUnknownMemberType]
                url,
                decode_responses=True,
                socket_timeout=block_s + BLOCK_SOCKET_MARGIN_S,
                socket_connect_timeout=block_s + BLOCK_SOCKET_MARGIN_S,
            )
        )

    async def take(self, *, block_s: float) -> dict[str, Any] | None:
        """阻塞取一条请求；这一拍内没有就给 None。

        Args: block_s。
        """
        raw = await self._run(
            self._client.brpop(
                [REQUEST_KEY], timeout=block_s
            )  # pyright: ignore[reportUnknownMemberType]
        )
        if raw is None:
            return None
        return _decode(raw)

    async def reply(
        self, request_id: str, payload: Mapping[str, Any], *, ttl_s: int
    ) -> None:
        """回一条应答并给它设存活期。

        ⚠ 必须带 traceparent：发起方在另一个进程里等这条应答，不带它链路就
        在这一跳断开（observability §4.2）。
        ⚠ 必须设 TTL：发起方超时走人后没人来取，不过期就会一直堆在 Redis 里。

        Args: request_id, payload, ttl_s。
        """
        key = reply_key(request_id)
        envelope = {**payload, TRACEPARENT_KEY: current_traceparent()}
        body = json.dumps(envelope, ensure_ascii=False, default=str)
        pipeline = self._client.pipeline()
        pipeline.lpush(key, body)
        pipeline.expire(key, ttl_s)
        await self._run(pipeline.execute())

    async def close(self) -> None:
        """关闭连接池。"""
        await self._client.aclose()

    @staticmethod
    async def _run(awaitable: Any) -> Any:
        try:
            return await awaitable
        except RedisError as error:
            raise DependencyUnavailable(
                "命令总线暂时不可用", context={"dependency": "redis"}
            ) from error


def _decode(raw: object) -> dict[str, Any] | None:
    """把 BRPOP 的回包解成请求信封；解不出给 None。

    ⚠ 一条坏消息不许让消费循环退出——那会让整个采集副本停止响应命令。

    Args: raw。
    """
    if not isinstance(raw, list | tuple):
        return None
    fields = cast("Sequence[object]", raw)
    if len(fields) < _PAIR:
        return None
    body = fields[1]
    if not isinstance(body, str):
        return None
    try:
        decoded: object = json.loads(body)
    except json.JSONDecodeError:
        _logger.warning(
            "command_payload_undecodable", "请求不是合法 JSON，已跳过"
        )
        return None
    if not isinstance(decoded, dict):
        _logger.warning(
            "command_payload_not_object", "请求不是 JSON 对象，已跳过"
        )
        return None
    # JSON 的边界：未知类型在这里收敛成有类型的信封，不许流进业务层
    return cast("dict[str, Any]", decoded)
