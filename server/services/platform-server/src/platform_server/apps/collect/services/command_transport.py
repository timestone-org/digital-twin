"""命令总线的传输面：Redis list 做的一问一答，platform 是**发起端**。

键名与信封字段的唯一真源是 `collectwire`，采集侧用的是同一份（ADR-0017）。
零业务逻辑：载荷怎么解释归 `command_bus.py`。
"""

import json
from collections.abc import Mapping, Sequence
from typing import Any, Protocol, cast

from redis.asyncio import Redis
from redis.exceptions import RedisError

from collectwire import (
    BLOCK_SOCKET_MARGIN_S,
    REPLY_PAIR_LENGTH,
    REQUEST_KEY,
    TRACEPARENT_KEY,
    reply_key,
)
from lib.errors import DependencyUnavailable
from lib.logging import current_traceparent, get_logger

_logger = get_logger("platform.collect.bus")


class CommandTransport(Protocol):
    """发起一次命令并等应答的最小面。真实现打 Redis，测试用进程内假件。"""

    async def call(
        self,
        envelope: Mapping[str, Any],
        *,
        request_id: str,
        timeout_s: float,
    ) -> dict[str, Any] | None:
        """投一条请求并等应答；这一拍内没等到就给 None。

        Args: envelope, request_id, timeout_s。
        """
        ...

    async def close(self) -> None: ...


class RedisCommandTransport:
    """Redis list 实现。驱动异常一律收敛成 `DependencyUnavailable`。"""

    def __init__(self, *, url: str, block_s: float) -> None:
        """按连接串初始化。构造不连网。

        Args: url, block_s（一次等应答的最长时长）。
        """
        socket_s = block_s + BLOCK_SOCKET_MARGIN_S
        # pyright: ignore 的理由 —— redis-py 的 from_url 形参标成 Unknown
        self._client: Redis = (
            Redis.from_url(  # pyright: ignore[reportUnknownMemberType]
                url,
                decode_responses=True,
                socket_timeout=socket_s,
                socket_connect_timeout=socket_s,
            )
        )

    async def call(
        self,
        envelope: Mapping[str, Any],
        *,
        request_id: str,
        timeout_s: float,
    ) -> dict[str, Any] | None:
        """投请求 → 阻塞等应答。超时给 None，由调用方决定怎么说。

        ⚠ 本层**不重试**：一条链路只有一层负责重试，而写值这条链路一层都不许
        重试（runtime-resilience §4.2 与 §2）。
        ⚠ traceparent 在这一层兜底盖一次：总线不会自动传播链路，漏了它链路就在
        这一跳齐断——platform 握着完整调用链，collector 那边只剩一段无根的日志
        （observability §4.2）。调用方给了就用调用方的。
        Args: envelope, request_id, timeout_s。
        """
        stamped = {TRACEPARENT_KEY: current_traceparent(), **dict(envelope)}
        body = json.dumps(stamped, ensure_ascii=False, default=str)
        await self._run(self._client.lpush(REQUEST_KEY, body))
        raw = await self._run(
            self._client.blpop(  # pyright: ignore[reportUnknownMemberType]
                [reply_key(request_id)], timeout=timeout_s
            )
        )
        return _decode(raw)

    async def close(self) -> None:
        """关闭连接池。"""
        await self._client.aclose()

    async def _run(self, awaitable: Any) -> Any:
        try:
            return await awaitable
        except RedisError as error:
            raise DependencyUnavailable(
                "命令总线暂时不可用", context={"dependency": "redis"}
            ) from error


def _decode(raw: object) -> dict[str, Any] | None:
    """把 BLPOP 的回包解成应答信封；解不出给 None。

    ⚠ 一条坏应答不许抛成 500：它与「现场没答复」对调用方是同一件事——
    这次命令没有结论。
    Args: raw。
    """
    if not isinstance(raw, list | tuple):
        return None
    fields = tuple(cast("Sequence[object]", raw))
    if len(fields) < REPLY_PAIR_LENGTH or not isinstance(fields[1], str):
        return None
    try:
        decoded: object = json.loads(fields[1])
    except json.JSONDecodeError:
        _logger.warning(
            "command_reply_undecodable", "应答不是合法 JSON，按无结论处理"
        )
        return None
    if not isinstance(decoded, dict):
        _logger.warning(
            "command_reply_not_object", "应答不是 JSON 对象，按无结论处理"
        )
        return None
    # JSON 的边界：未知类型在这里收敛成有类型的信封，不许流进业务层
    return cast("dict[str, Any]", decoded)
