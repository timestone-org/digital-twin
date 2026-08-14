"""守真 Redis 上的租约语义：抢、CAS 续、CAS 让。

⚠ 假件与真实现在这三条上不一致的后果是**生产双主、测试全绿**——这是所有
测试替身里唯一会静默损坏数据的一处（project-structure-python §5.4）。
"""

from uuid import uuid4

import pytest

from collector_server.lease import RedisLease

TTL_S = 5


@pytest.fixture
def key() -> str:
    """一把每条用例都不一样的租约键。"""
    return f"collect:test:leader:{uuid4()}"


def _lease(url: str, key: str, token: str) -> RedisLease:
    return RedisLease(url=url, key=key, token=token, ttl_s=TTL_S)


async def test_only_the_first_replica_takes_the_lease(
    redis_url: str, key: str
) -> None:
    first = _lease(redis_url, key, "replica-a")
    second = _lease(redis_url, key, "replica-b")
    try:
        assert await first.acquire() is True
        assert await second.acquire() is False
    finally:
        await first.release()
        await first.close()
        await second.close()


async def test_a_replica_can_renew_its_own_lease(
    redis_url: str, key: str
) -> None:
    lease = _lease(redis_url, key, "replica-a")
    try:
        await lease.acquire()
        assert await lease.renew() is True
    finally:
        await lease.release()
        await lease.close()


async def test_a_replica_cannot_renew_someone_elses_lease(
    redis_url: str, key: str
) -> None:
    holder = _lease(redis_url, key, "replica-a")
    other = _lease(redis_url, key, "replica-b")
    try:
        await holder.acquire()
        assert await other.renew() is False
    finally:
        await holder.release()
        await holder.close()
        await other.close()


async def test_a_replica_cannot_release_someone_elses_lease(
    redis_url: str, key: str
) -> None:
    holder = _lease(redis_url, key, "replica-a")
    other = _lease(redis_url, key, "replica-b")
    try:
        await holder.acquire()
        await other.release()
        assert await other.acquire() is False
    finally:
        await holder.release()
        await holder.close()
        await other.close()


async def test_letting_go_hands_the_lease_over_immediately(
    redis_url: str, key: str
) -> None:
    holder = _lease(redis_url, key, "replica-a")
    successor = _lease(redis_url, key, "replica-b")
    try:
        await holder.acquire()
        await holder.release()
        assert await successor.acquire() is True
    finally:
        await successor.release()
        await holder.close()
        await successor.close()


async def test_renewing_a_lease_nobody_holds_is_refused(
    redis_url: str, key: str
) -> None:
    lease = _lease(redis_url, key, "replica-a")
    try:
        assert await lease.renew() is False
    finally:
        await lease.close()


async def test_an_unreachable_redis_means_not_leader() -> None:
    # 没有服务在这个端口上：连它一定被拒
    lease = RedisLease(
        url="redis://127.0.0.1:1/0",
        key="collect:test:leader:nowhere",
        token="replica-a",
        ttl_s=TTL_S,
        timeout_s=0.2,
    )
    try:
        assert await lease.acquire() is False
        assert await lease.renew() is False
        assert await lease.ping() is False
    finally:
        await lease.close()
