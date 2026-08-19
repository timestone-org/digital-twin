"""Redis 快照面：一个数据源一个哈希键。

键名的唯一真源是 `collectwire`，读侧 platform-publisher 用同一份（ADR-0017）。
零业务逻辑——编码归 sink，本模块只搬字符串并统一收敛 Redis 异常。
"""

from collections.abc import Mapping, Sequence
from typing import Any, Protocol, cast
from uuid import UUID

from redis.asyncio import Redis
from redis.exceptions import RedisError

from collectwire import snapshot_key
from lib.errors import DependencyUnavailable
from lib.logging import get_logger

_logger = get_logger("collect.snapshot")


class SnapshotStore(Protocol):
    """快照写入面。真实现打 Redis，测试用进程内假件。"""

    async def write_many(
        self, batch: Mapping[UUID, Mapping[str, str]], *, ttl_s: int
    ) -> None: ...

    async def touch(
        self, source_ids: Sequence[UUID], *, ttl_s: int
    ) -> None: ...

    async def drop(self, source_id: UUID) -> None: ...

    async def ping(self) -> bool: ...

    async def close(self) -> None: ...


class RedisSnapshotStore:
    """Redis 哈希实现。"""

    def __init__(self, *, url: str, timeout_s: float = 1.0) -> None:
        """按连接串初始化。

        Args: url, timeout_s。
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

    async def write_many(
        self, batch: Mapping[UUID, Mapping[str, str]], *, ttl_s: int
    ) -> None:
        """把一窗里各数据源的读数各写进自己的哈希，**一个往返写一批**。

        ⚠ 按数据源逐个往返会让一拍的耗时随数据源数线性涨：快照窗口默认
        300ms，而每一个往返都是串行等回包的。`touch` 早就是一批一个往返，
        这里同理。
        ⚠ 每次 flush 都续 TTL：采集进程死掉后快照跟着过期，大屏于是拿不到值
        而不是拿着一份永不更新的旧值当实时值看。

        Args: batch（数据源 → 这一窗的字段表）, ttl_s。
        """
        if not batch:
            return
        pipeline = self._client.pipeline()
        for source_id, fields in batch.items():
            key = snapshot_key(source_id)
            # cast 的理由 —— redis-py 的 mapping 形参用了自己的编码类型变量
            pipeline.hset(key, mapping=cast("Any", dict(fields)))
            pipeline.expire(key, ttl_s)
        await self._run(pipeline.execute())

    async def touch(self, source_ids: Sequence[UUID], *, ttl_s: int) -> None:
        """只续存活期，一个往返续一批。没有这个键就什么都不做。

        ⚠ 给「这一窗没有新读数」的数据源用：订阅只在值变化时回调，一个一天
        变一次的点位不会有写入，没人续期它的快照就会到期消失。

        Args: source_ids, ttl_s。
        """
        if not source_ids:
            return
        pipeline = self._client.pipeline()
        for source_id in source_ids:
            pipeline.expire(snapshot_key(source_id), ttl_s)
        await self._run(pipeline.execute())

    async def drop(self, source_id: UUID) -> None:
        """删掉一个数据源的快照。数据源从计划里移走时用。

        Args: source_id。
        """
        await self._run(self._client.delete(snapshot_key(source_id)))

    async def ping(self) -> bool:
        """连通性自检。不抛，供探针复用。"""
        try:
            await self._client.ping()  # pyright: ignore[reportUnknownMemberType]
        except RedisError as error:
            _logger.warning("redis_ping_failed", "Redis 不可达", error=error)
            return False
        return True

    async def close(self) -> None:
        """关闭连接池。"""
        await self._client.aclose()

    @staticmethod
    async def _run(awaitable: Any) -> Any:
        try:
            return await awaitable
        except RedisError as error:
            raise DependencyUnavailable(
                "缓存服务暂时不可用", context={"dependency": "redis"}
            ) from error
