"""命令总线的传输面：Redis list 做的一问一答。

键名与信封字段的唯一真源是 `collectwire`，两侧共用（ADR-0017）。
零业务逻辑——载荷怎么解释归 `apps/collect/bus/consumer.py`。
"""

import json
from asyncio import get_running_loop, sleep
from collections.abc import Mapping
from typing import Any, Protocol, cast

from redis.asyncio import Redis
from redis.exceptions import RedisError

from collector_server.lease import RedisLease
from collectwire import REQUEST_KEY, TRACEPARENT_KEY, reply_key
from lib.errors import DependencyUnavailable
from lib.logging import current_traceparent, get_logger

_logger = get_logger("collect.commands")

POLL_INTERVAL_S = 0.1
_TAKE_SCRIPT = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('RPOP', KEYS[2])
end
return false
"""


class CommandTransport(Protocol):
    """命令总线的最小面。真实现打 Redis，测试用进程内假件。"""

    async def take(self, *, block_s: float) -> dict[str, Any] | None: ...

    async def reply(
        self, request_id: str, payload: Mapping[str, Any], *, ttl_s: int
    ) -> None: ...

    async def close(self) -> None: ...


class RedisCommandTransport:
    """Redis list 实现。"""

    def __init__(
        self, *, url: str, lease: RedisLease, timeout_s: float
    ) -> None:
        """按连接串初始化。

        Args: url, lease, timeout_s。
        """
        # pyright: ignore 的理由 —— redis-py 的 from_url 形参标成 Unknown
        self._client: Redis = (
            Redis.from_url(  # pyright: ignore[reportUnknownMemberType]
                url,
                decode_responses=True,
                socket_timeout=timeout_s,
                socket_connect_timeout=timeout_s,
            )
        )
        self._lease = lease

    async def take(self, *, block_s: float) -> dict[str, Any] | None:
        """在等待预算内取一条仍由本次租约持有的请求。

        Args: block_s。
        """
        loop = get_running_loop()
        deadline = loop.time() + block_s
        token = self._lease.token
        if token is None:
            await sleep(block_s)
            return None
        while token == self._lease.token and loop.time() < deadline:
            raw: object = await self._run(
                self._client.eval(  # pyright: ignore[reportUnknownMemberType]
                    _TAKE_SCRIPT, 2, self._lease.key, REQUEST_KEY, token
                )
            )
            if raw is not None:
                return _decode(raw)
            remaining_s = deadline - loop.time()
            if remaining_s <= 0:
                break
            await sleep(min(POLL_INTERVAL_S, remaining_s))
        return None

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
    """把 Redis 中的载荷解成请求信封；解不出给 None。

    ⚠ 一条坏消息不许让消费循环退出——那会让整个采集副本停止响应命令。

    Args: raw。
    """
    if not isinstance(raw, str):
        return None
    try:
        decoded: object = json.loads(raw)
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
