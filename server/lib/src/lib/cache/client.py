"""Redis 封装：统一超时、统一异常包裹、JSON 编解码。

基础设施异常不裸露给上层——`redis.RedisError` 一律包成 `DependencyUnavailable`，
业务层不必认识第三方库的异常类型。
"""

import json
from typing import Any

from redis.asyncio import Redis
from redis.exceptions import RedisError

from lib.errors.base import DependencyUnavailable
from lib.logging.logger import get_logger

_logger = get_logger("lib.cache")

# 值等于自己才续期。否则会续到别人的键上，两个持有者同时以为自己独占
_RENEW_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('expire', KEYS[1], ARGV[2])
end
return 0
"""
# 值等于自己才删。否则会删掉接任者的那一份，而它正以为自己独占着
_DELETE_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
end
return 0
"""


class Cache:
    """一个 Redis 连接池的句柄。"""

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
        """连通性自检。不抛，供探针复用。"""
        try:
            await self._client.ping()  # pyright: ignore[reportUnknownMemberType]
        except RedisError as error:
            _logger.warning("redis_ping_failed", "Redis 不可达", error=error)
            return False
        return True

    async def get_json(self, key: str) -> Any | None:
        """读一个 JSON 值；键不存在或内容损坏返回 None。

        Args: key。
        """
        raw = await self._run(self._client.get(key))
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            _logger.warning("cache_value_corrupt", "缓存值不是合法 JSON")
            return None

    async def set_json(self, key: str, value: Any, *, ttl_s: int) -> None:
        """写一个带 TTL 的 JSON 值。

        Args: key, value, ttl_s。
        """
        payload = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        await self._run(self._client.set(key, payload, ex=ttl_s))

    async def set_if_absent(self, key: str, value: str, *, ttl_s: int) -> bool:
        """`SET NX PX`：抢到返回 True。幂等键与互斥都靠它，不靠「先查再插」。

        Args: key, value, ttl_s。
        """
        result = await self._run(
            self._client.set(key, value, ex=ttl_s, nx=True)
        )
        return bool(result)

    async def renew_if_owner(self, key: str, value: str, *, ttl_s: int) -> bool:
        """值还等于 `value` 才续期，续上返回 True。

        ⚠ 必须是 CAS 而不是「先读再写」：读到自己、写回去之间键可能已经过期
        并被别人抢走，那一写就把别人的锁改成了自己的，两个持有者同时以为自己
        独占——而两边都不会报错。
        Args: key, value, ttl_s。
        """
        return bool(
            await self._run(
                self._client.eval(  # pyright: ignore[reportUnknownMemberType]
                    _RENEW_SCRIPT, 1, key, value, ttl_s
                )
            )
        )

    async def delete_if_owner(self, key: str, value: str) -> bool:
        """值还等于 `value` 才删，删掉返回 True。

        ⚠ 放锁必须是 CAS：自己那把锁可能早已过期并被别人抢走，无条件删就是
        把接任者的锁一起删掉——而它正以为自己独占着，两边同时在写。
        Args: key, value。
        """
        return bool(
            await self._run(
                self._client.eval(  # pyright: ignore[reportUnknownMemberType]
                    _DELETE_SCRIPT, 1, key, value
                )
            )
        )

    async def get(self, key: str) -> str | None:
        """读一个字符串值。

        Args: key。
        """
        return await self._run(self._client.get(key))

    async def delete(self, key: str) -> None:
        """删一个键。

        Args: key。
        """
        await self._run(self._client.delete(key))

    async def add_to_set(self, key: str, *members: str) -> None:
        """把成员加进一个集合。同一个成员加两次只留一份。

        Args: key, members。
        """
        if not members:
            return
        await self._run(self._client.sadd(key, *members))

    async def exists(self, key: str) -> bool:
        """键是否存在。

        Args: key。
        """
        return bool(await self._run(self._client.exists(key)))

    async def incr_in_window(self, key: str, *, window_s: int) -> int:
        """窗口内自增并返回当前计数；首次自增时设 TTL。

        Args: key, window_s。
        """
        pipeline = self._client.pipeline()
        pipeline.incr(key)
        pipeline.expire(key, window_s, nx=True)
        results = await self._run(pipeline.execute())
        return int(results[0])

    async def close(self) -> None:
        """关闭连接池。"""
        await self._client.aclose()

    @staticmethod
    async def _run(awaitable: Any) -> Any:
        try:
            return await awaitable
        except RedisError as error:
            raise DependencyUnavailable(
                "缓存服务暂时不可用",
                context={"dependency": "redis"},
            ) from error
