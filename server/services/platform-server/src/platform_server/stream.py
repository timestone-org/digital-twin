"""Redis Stream 的最小读写面：发布、消费组、认领滞留消息、确认。

⚠ 队列是 at-least-once，重复投递是常态而非异常：去重不在这一层做，消费者
必须自己幂等（docs/agents/runtime-resilience.md §5）。本模块零业务名词，
第二个消费方出现时可以整体上移到 `lib`。
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Protocol, cast

from redis.asyncio import Redis
from redis.exceptions import RedisError, ResponseError

from lib.errors import DependencyUnavailable
from lib.logging import get_logger

_logger = get_logger("platform.stream")

# 消费组已存在时 XGROUP CREATE 抛的错，按已就绪处理
_GROUP_EXISTS = "BUSYGROUP"
# XAUTOCLAIM 从头扫起
_CLAIM_START = "0-0"
# 只取还没派给任何消费者的新消息
_NEW_MESSAGES = ">"
# 回包里 `(id, 字段)` 这一对的长度
_PAIR = 2


@dataclass(frozen=True)
class StreamGroup:
    """一个消费者在某条流上的身份。"""

    stream: str
    group: str
    consumer: str


@dataclass(frozen=True)
class StreamEntry:
    """流里的一条消息。字段是扁平的字符串键值，便于用 redis-cli 直接看。"""

    entry_id: str
    fields: Mapping[str, str]


class StreamLike(Protocol):
    """流的最小读写面。真实现是 `RedisStream`，测试用进程内假件。"""

    async def publish(self, stream: str, fields: Mapping[str, str]) -> str: ...

    async def ensure_group(self, target: StreamGroup) -> None: ...

    async def read_group(
        self, target: StreamGroup, *, count: int, block_ms: int
    ) -> list[StreamEntry]: ...

    async def claim_stale(
        self, target: StreamGroup, *, min_idle_ms: int, count: int
    ) -> list[StreamEntry]: ...

    async def ack(self, target: StreamGroup, entry_id: str) -> None: ...

    async def close(self) -> None: ...


class RedisStream:
    """Redis Stream 客户端。驱动异常一律收敛成 `DependencyUnavailable`。"""

    def __init__(self, *, url: str, timeout_s: float = 1.0) -> None:
        # pyright: ignore 的理由 —— redis-py 的 from_url 形参标成 Unknown
        self._client: Redis = (
            Redis.from_url(  # pyright: ignore[reportUnknownMemberType]
                url,
                decode_responses=True,
                socket_timeout=timeout_s,
                socket_connect_timeout=timeout_s,
            )
        )

    async def ping(self) -> bool:
        """连通性自检。不抛，供启动自检复用。"""
        try:
            await self._client.ping()  # pyright: ignore[reportUnknownMemberType]
        except RedisError as error:
            _logger.warning("redis_ping_failed", "Redis 不可达", error=error)
            return False
        return True

    async def publish(self, stream: str, fields: Mapping[str, str]) -> str:
        """投一条消息，返回它的条目 id。

        ⚠ 本层只搬字段，不认识业务信封：traceparent 必须由调用方放进 `fields`，
        队列不会自动传播它（docs/agents/observability.md §4.2）。
        Args: stream, fields。
        """
        payload = cast(Any, dict(fields))
        entry_id = await self._run(self._client.xadd(stream, payload))
        return str(entry_id)

    async def ensure_group(self, target: StreamGroup) -> None:
        """建消费组；已存在即当作就绪。

        ⚠ `mkstream=True` 不能省：流还没有任何消息时建组会直接报错，而这正是
        全新部署的常态——省掉它，第一个 worker 起不来。
        Args: target。
        """
        try:
            await self._client.xgroup_create(
                target.stream, target.group, id="0", mkstream=True
            )
        except ResponseError as error:
            if _GROUP_EXISTS not in str(error):
                raise DependencyUnavailable(
                    "队列暂时不可用", context={"dependency": "redis"}
                ) from error
        except RedisError as error:
            raise DependencyUnavailable(
                "队列暂时不可用", context={"dependency": "redis"}
            ) from error

    async def read_group(
        self, target: StreamGroup, *, count: int, block_ms: int
    ) -> list[StreamEntry]:
        """取一批还没派出去的新消息；没有就阻塞到超时后给空表。

        Args: target, count, block_ms。
        """
        raw = await self._run(
            self._client.xreadgroup(
                target.group,
                target.consumer,
                {target.stream: _NEW_MESSAGES},
                count=count,
                block=block_ms,
            )
        )
        return _from_read(raw)

    async def claim_stale(
        self, target: StreamGroup, *, min_idle_ms: int, count: int
    ) -> list[StreamEntry]:
        """认领超时未确认的消息。

        ⚠ 没有这一步，消费者崩在 ack 之前的那条消息会永远躺在待确认表里：
        at-least-once 就成了 at-most-once，而分片会静默地少跑一个。
        Args: target, min_idle_ms, count。
        """
        raw = await self._run(
            self._client.xautoclaim(
                target.stream,
                target.group,
                target.consumer,
                min_idle_time=min_idle_ms,
                start_id=_CLAIM_START,
                count=count,
            )
        )
        return _from_claim(raw)

    async def ack(self, target: StreamGroup, entry_id: str) -> None:
        """确认一条消息已处理完。

        Args: target, entry_id。
        """
        await self._run(
            self._client.xack(target.stream, target.group, entry_id)
        )

    async def close(self) -> None:
        """关闭连接池。"""
        await self._client.aclose()

    @staticmethod
    async def _run(awaitable: Any) -> Any:
        try:
            return await awaitable
        except RedisError as error:
            raise DependencyUnavailable(
                "队列暂时不可用", context={"dependency": "redis"}
            ) from error


def _as_list(value: Any) -> list[Any]:
    """redis-py 的回包标成 Unknown，在这一处一次性收敛成明确形状。

    ⚠ 不让 Unknown 流进业务层：它会让类型检查在它经过的每一处静默失效。
    Args: value。
    """
    if isinstance(value, (list, tuple)):
        return list(cast(list[Any], value))
    return []


def _from_read(raw: Any) -> list[StreamEntry]:
    """XREADGROUP 的回包摊平成条目表。

    ⚠ 它按流分组回，一条流也要先剥一层，否则拿到的是 `(流名, 消息表)` 元组。
    Args: raw。
    """
    found: list[StreamEntry] = []
    for group in _as_list(raw):
        pair = _as_list(group)
        if len(pair) == _PAIR:
            found.extend(_entries(pair[1]))
    return found


def _from_claim(raw: Any) -> list[StreamEntry]:
    """XAUTOCLAIM 的回包取中间那段消息表。

    Args: raw。
    """
    pair = _as_list(raw)
    return _entries(pair[1]) if len(pair) >= _PAIR else []


def _entries(messages: Any) -> list[StreamEntry]:
    """`[(id, {字段}), …]` 转成条目表；形状不符的条目直接跳过。

    Args: messages。
    """
    found: list[StreamEntry] = []
    for item in _as_list(messages):
        pair = _as_list(item)
        if len(pair) != _PAIR or not isinstance(pair[1], dict):
            continue
        found.append(
            StreamEntry(
                entry_id=str(pair[0]),
                fields=_as_text(cast(dict[Any, Any], pair[1])),
            )
        )
    return found


def _as_text(fields: Mapping[Any, Any]) -> dict[str, str]:
    """键值一律收成字符串。

    Args: fields。
    """
    return {str(key): str(value) for key, value in fields.items()}
