"""Redis 租约：单活角色靠它选主。零业务名词。

⚠ 这套语义（`SET NX PX` / CAS 续约 / CAS 释放）必须逐条有测试锁住：假件与
真实现不一致的后果是**生产双主、测试全绿**——这是所有测试替身里唯一会静默
损坏数据的一处（project-structure-python.md §5.4）。
"""

from typing import Any, Protocol

from redis.asyncio import Redis
from redis.exceptions import RedisError

from lib.logging import get_logger

_logger = get_logger("collect.lease")

# 值等于自己才续。否则会续到别人的租约上，两个进程一起以为自己是主
RENEW_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0
"""
# 值等于自己才删。否则会删掉接任者的租约
RELEASE_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
end
return 0
"""

MS_PER_S = 1000


class Lease(Protocol):
    """租约的最小面。真实现打 Redis，测试用进程内假件。"""

    async def acquire(self) -> bool: ...

    async def renew(self) -> bool: ...

    async def release(self) -> None: ...

    async def ping(self) -> bool: ...

    async def close(self) -> None: ...


class RedisLease:
    """一个进程实例持有的租约。"""

    def __init__(
        self,
        *,
        url: str,
        key: str,
        token: str,
        ttl_s: int,
        timeout_s: float = 1.0,
    ) -> None:
        """按键与本进程的令牌初始化。

        Args: url, key, token（本进程唯一）, ttl_s, timeout_s。
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
        self._key = key
        self._token = token
        self._ttl_s = ttl_s

    async def acquire(self) -> bool:
        """抢租约。抢到返回 True。"""
        return await self._guarded(
            self._client.set(self._key, self._token, ex=self._ttl_s, nx=True),
            action="acquire",
        )

    async def renew(self) -> bool:
        """CAS 续约。续不上返回 False，调用方必须立刻停手（renew-or-die）。"""
        return await self._guarded(
            self._client.eval(  # pyright: ignore[reportUnknownMemberType]
                RENEW_SCRIPT,
                1,
                self._key,
                self._token,
                self._ttl_s * MS_PER_S,
            ),
            action="renew",
        )

    async def release(self) -> None:
        """CAS 释放，主动让位。

        ⚠ 让位比等它自然过期快一个 TTL：热备能立刻接管，而不是等 15 秒。
        """
        await self._guarded(
            self._client.eval(  # pyright: ignore[reportUnknownMemberType]
                RELEASE_SCRIPT, 1, self._key, self._token
            ),
            action="release",
        )

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

    async def _guarded(self, awaitable: Any, *, action: str) -> bool:
        """跑一次 Redis 操作；不可达一律判否。

        ⚠ 这是本文件唯一的降级方向：**Redis 不可达一律判非 leader**。宁可
        没人干活，也不要两个进程同时对同一台设备建会话
        （runtime-resilience §6.2）。

        Args: awaitable, action。
        """
        try:
            result: object = await awaitable
        except RedisError as error:
            _logger.error(
                "lease_operation_failed",
                "租约操作失败，按非 leader 处理",
                action=action,
                error_type=type(error).__name__,
            )
            return False
        return bool(result)
