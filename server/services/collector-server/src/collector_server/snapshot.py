"""Redis 快照面：一个数据源一个哈希键。

键名的唯一真源是 `collectwire`，读侧 platform-publisher 用同一份（ADR-0017）。
零业务逻辑——编码归 sink，本模块只搬字符串并统一收敛 Redis 异常。
"""

from collections.abc import Mapping, Sequence
from itertools import batched
from typing import Any, Protocol, cast
from uuid import UUID

from redis.asyncio import Redis
from redis.asyncio.client import Pipeline
from redis.exceptions import RedisError

from collector_server.lease import RedisLease
from collectwire import snapshot_key, snapshot_owner_stamp, snapshot_owners_key
from lib.errors import DependencyUnavailable
from lib.logging import get_logger

_logger = get_logger("collect.snapshot")
FIELD_SCAN_CHUNK = 256

_CHECK_OWNER = """
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
"""
_WRITE_SCRIPT = _CHECK_OWNER + """
local fields, owners = {}, {}
for at = 3, #ARGV, 3 do
    local field = ARGV[at]
    fields[#fields+1], fields[#fields+2] = field, ARGV[at+1]
    owners[#owners+1], owners[#owners+2] = field, ARGV[at+2]
    if #fields == 512 or at+2 == #ARGV then
        redis.call('HSET', KEYS[2], unpack(fields))
        redis.call('HSET', KEYS[3], unpack(owners))
        fields, owners = {}, {}
    end
end
redis.call('EXPIRE', KEYS[2], ARGV[2])
redis.call('EXPIRE', KEYS[3], ARGV[2])
return 1
"""
_MUTATE_SCRIPT = _CHECK_OWNER + """
for at = 2, 3 do
    redis.call(ARGV[2], KEYS[at], unpack(ARGV, 3))
end
return 1
"""


class SnapshotStore(Protocol):
    """快照写入面。真实现打 Redis，测试用进程内假件。"""

    @property
    def lease_token(self) -> str | None: ...

    async def write_many(
        self,
        batch: Mapping[UUID, Mapping[str, str]],
        *,
        ttl_s: int,
        lease_token: str | None = None,
    ) -> None: ...

    async def touch(
        self,
        source_ids: Sequence[UUID],
        *,
        ttl_s: int,
        lease_token: str | None = None,
    ) -> None: ...

    async def drop(
        self, source_id: UUID, *, lease_token: str | None = None
    ) -> None: ...

    async def retain_fields(
        self,
        source_id: UUID,
        point_codes: frozenset[str],
        *,
        lease_token: str | None = None,
    ) -> None: ...

    async def ping(self) -> bool: ...

    async def close(self) -> None: ...


class RedisSnapshotStore:
    """Redis 哈希实现。"""

    def __init__(
        self, *, url: str, lease: RedisLease, timeout_s: float = 1.0
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

    @property
    def lease_token(self) -> str | None:
        """当前副本的租约令牌。是否仍持有由 Redis 校验。"""
        return self._lease.token

    async def write_many(
        self,
        batch: Mapping[UUID, Mapping[str, str]],
        *,
        ttl_s: int,
        lease_token: str | None = None,
    ) -> None:
        """在一个往返内写入各数据源的读数与逐点位属主。"""
        token = lease_token if lease_token is not None else self.lease_token
        if token is None or not batch:
            return
        pipeline = self._client.pipeline()
        for source_id, fields in batch.items():
            if fields:
                args = [
                    part
                    for code, raw in fields.items()
                    for part in (code, raw, snapshot_owner_stamp(token, raw))
                ]
                self._enqueue(
                    pipeline, _WRITE_SCRIPT, source_id, (token, ttl_s, *args)
                )
        await self._run(pipeline.execute())

    async def touch(
        self,
        source_ids: Sequence[UUID],
        *,
        ttl_s: int,
        lease_token: str | None = None,
    ) -> None:
        """给已有的快照和属主一起续期。"""
        token = lease_token if lease_token is not None else self.lease_token
        if token is None or not source_ids:
            return
        pipeline = self._client.pipeline()
        for source_id in source_ids:
            self._enqueue(
                pipeline, _MUTATE_SCRIPT, source_id, (token, "EXPIRE", ttl_s)
            )
        await self._run(pipeline.execute())

    async def drop(
        self, source_id: UUID, *, lease_token: str | None = None
    ) -> None:
        """删除不再采集的数据源快照与属主。"""
        token = lease_token if lease_token is not None else self.lease_token
        if token is not None:
            await self._mutate(source_id, (token, "DEL"))

    async def retain_fields(
        self,
        source_id: UUID,
        point_codes: frozenset[str],
        *,
        lease_token: str | None = None,
    ) -> None:
        """扫描停采字段；只在 Redis 仍认同当前租约时删除。"""
        token = lease_token if lease_token is not None else self.lease_token
        if token is None:
            return
        key = snapshot_key(source_id)
        cursor = 0
        while True:
            raw = await self._run(
                self._client.hscan(key, cursor=cursor, count=FIELD_SCAN_CHUNK)
            )
            cursor, fields = cast("tuple[int, Mapping[str, str]]", raw)
            retired = (field for field in fields if field not in point_codes)
            for batch in batched(retired, FIELD_SCAN_CHUNK):
                if not await self._mutate(source_id, (token, "HDEL", *batch)):
                    return
            if cursor == 0:
                return

    async def _mutate(self, source_id: UUID, args: Sequence[str]) -> bool:
        """在同一条命令核对租约并修改两份哈希。Args: source_id, args。"""
        pipeline = self._client.pipeline(transaction=False)
        self._enqueue(pipeline, _MUTATE_SCRIPT, source_id, args)
        answer: list[object] = await self._run(pipeline.execute())
        return answer == [1]

    def _enqueue(
        self,
        pipeline: Pipeline,
        script: str,
        source_id: UUID,
        args: Sequence[str | int],
    ) -> None:
        """添加受租约约束的命令。Args: pipeline, script, source_id, args。"""
        # pyright: ignore 的理由 —— redis-py 的命令形参标成 Unknown
        pipeline.execute_command(  # pyright: ignore[reportUnknownMemberType]
            "EVAL",
            script,
            3,
            self._lease.key,
            snapshot_key(source_id),
            snapshot_owners_key(source_id),
            *args,
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

    @staticmethod
    async def _run(awaitable: Any) -> Any:
        try:
            return await awaitable
        except RedisError as error:
            raise DependencyUnavailable(
                "缓存服务暂时不可用", context={"dependency": "redis"}
            ) from error
