"""守真 Redis 上的租约语义：抢、CAS 续、CAS 让。

⚠ 假件与真实现在这三条上不一致的后果是**生产双主、测试全绿**——两个 publisher
会对同一个主题各推各的，而客户端在同一段 `seq` 里收到两份不同的值。
"""

from uuid import uuid4

import pytest

from platform_server.lease import RedisLease

TTL_S = 5


@pytest.fixture
def lease_key() -> str:
    """一把每条用例都不一样的租约键。"""
    return f"platform:test:publisher:{uuid4()}"


def build_lease(url: str, key: str, token: str) -> RedisLease:
    """一个副本手里的租约。

    Args: url, key, token。
    """
    return RedisLease(url=url, key=key, token=token, ttl_s=TTL_S)


async def test_only_the_first_replica_takes_the_lease(
    redis_url: str, lease_key: str
) -> None:
    first = build_lease(redis_url, lease_key, "publisher-a")
    second = build_lease(redis_url, lease_key, "publisher-b")
    try:
        assert await first.acquire() is True
        assert await second.acquire() is False
    finally:
        await first.release()
        await first.close()
        await second.close()


async def test_a_replica_renews_its_own_lease(
    redis_url: str, lease_key: str
) -> None:
    lease = build_lease(redis_url, lease_key, "publisher-a")
    try:
        await lease.acquire()
        assert await lease.renew() is True
    finally:
        await lease.release()
        await lease.close()


async def test_a_replica_cannot_renew_someone_elses_lease(
    redis_url: str, lease_key: str
) -> None:
    # ⚠ 少了 CAS，热备会把主的租约续到自己名下，两个进程一起以为自己是主
    holder = build_lease(redis_url, lease_key, "publisher-a")
    other = build_lease(redis_url, lease_key, "publisher-b")
    try:
        await holder.acquire()
        assert await other.renew() is False
    finally:
        await holder.release()
        await holder.close()
        await other.close()


async def test_standing_down_lets_the_standby_take_over_at_once(
    redis_url: str, lease_key: str
) -> None:
    # 让位比等它自然过期快一个 TTL——那一整段时间里大屏是静默的
    holder = build_lease(redis_url, lease_key, "publisher-a")
    standby = build_lease(redis_url, lease_key, "publisher-b")
    try:
        await holder.acquire()
        await holder.release()
        assert await standby.acquire() is True
    finally:
        await standby.release()
        await holder.close()
        await standby.close()


async def test_a_replica_cannot_release_someone_elses_lease(
    redis_url: str, lease_key: str
) -> None:
    holder = build_lease(redis_url, lease_key, "publisher-a")
    other = build_lease(redis_url, lease_key, "publisher-b")
    try:
        await holder.acquire()
        await other.release()
        assert await holder.renew() is True
    finally:
        await holder.release()
        await holder.close()
        await other.close()


async def test_an_unreachable_redis_is_read_as_not_being_leader() -> None:
    # ⚠ 唯一的降级方向：宁可这一拍没人推，也不要两个进程同时推
    lease = RedisLease(
        url="redis://127.0.0.1:1/0",
        key="platform:test:unreachable",
        token="publisher-a",
        ttl_s=TTL_S,
        timeout_s=0.2,
    )
    try:
        assert await lease.acquire() is False
        assert await lease.renew() is False
    finally:
        await lease.close()
