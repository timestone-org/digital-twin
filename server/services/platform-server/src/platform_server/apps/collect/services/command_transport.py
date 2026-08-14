"""命令总线的传输面：Redis list 做的一问一答，platform 是**发起端**。

请求进 `collect:cmd:req`，应答进 `collect:cmd:reply:{request_id}`。键名与信封
字段与 collector-server 的 `commands.py` 逐字一致——服务之间不许互相 import，
故只能两边各写一份，改一边就要改另一边（docs/COLLECT_DESIGN.md §5.3）。
零业务逻辑：载荷怎么解释归 `command_bus.py`。
"""

import json
from collections.abc import Mapping, Sequence
from typing import Any, Protocol, cast

from redis.asyncio import Redis
from redis.exceptions import RedisError

from lib.errors import DependencyUnavailable
from lib.logging import current_log_context, get_logger
from lib.web.middleware import new_span_id, new_trace_id

_logger = get_logger("platform.collect.bus")

# 信封里承载链路的键名，与 api-contract §10 的消息契约同名
TRACEPARENT_KEY = "traceparent"

REQUEST_KEY = "collect:cmd:req"
REPLY_PREFIX = "collect:cmd:reply"

# ⚠ 阻塞等应答的连接不能用 1s 的 socket 超时：BLPOP 阻塞满一拍就会被驱动层判成
# 读超时抛出来，于是「现场还没答复」被报成「Redis 坏了」。socket 超时必须比阻塞
# 时长再宽一点
BLOCK_SOCKET_MARGIN_S = 5.0
# BLPOP 回包里 `(键名, 内容)` 这一对的长度
_PAIR = 2


def reply_key(request_id: str) -> str:
    """一次请求的应答键。

    Args: request_id。
    """
    return f"{REPLY_PREFIX}:{request_id}"


def current_traceparent() -> str:
    """当前上下文的 W3C traceparent；没有上下文就现开一条链路。"""
    context = current_log_context()
    trace_id = context.trace_id or new_trace_id()
    span_id = context.span_id or new_span_id()
    return f"00-{trace_id}-{span_id}-01"


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
    if len(fields) < _PAIR or not isinstance(fields[1], str):
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
