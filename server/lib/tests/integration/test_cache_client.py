"""锁住 Cache 的三条契约：JSON 往返、`SET NX` 的互斥、窗口计数只设一次 TTL。

⚠ 必须打真实 Redis：`SET NX PX` 的原子性与 `EXPIRE ... NX` 的语义正是这层的
全部价值，假件对它们的近似若与真实现不一致，后果是「生产双主、测试全绿」。
"""

import uuid
from collections.abc import AsyncIterator

import pytest

from lib.cache import Cache
from lib.errors.base import DependencyUnavailable

WINDOW_S = 60
TTL_S = 30


@pytest.fixture
async def cache(redis_url: str) -> AsyncIterator[Cache]:
    handle = Cache(url=redis_url, timeout_s=2.0)
    yield handle
    await handle.close()


@pytest.fixture
def key() -> str:
    """每条用例一个独占键，用例之间不共享残留数据。"""
    return f"lib-test:{uuid.uuid4()}"


async def test_ping_is_true_against_a_live_server(cache: Cache) -> None:
    assert await cache.ping() is True


async def test_json_round_trips_including_non_ascii(
    cache: Cache, key: str
) -> None:
    await cache.set_json(key, {"名字": "张三", "n": 1}, ttl_s=TTL_S)
    assert await cache.get_json(key) == {"名字": "张三", "n": 1}


async def test_get_json_returns_none_for_a_missing_key(
    cache: Cache, key: str
) -> None:
    assert await cache.get_json(key) is None


async def test_get_json_returns_none_when_the_value_is_corrupt(
    cache: Cache, key: str
) -> None:
    # ⚠ 损坏的缓存值不能把调用方打成 500：缓存是可以为空的
    await cache.set_json(key, "x", ttl_s=TTL_S)
    await cache.delete(key)
    # 这个值只能从外部写坏，故直接用底层客户端塞一段非法 JSON 进去
    await cache._run(cache._client.set(key, "{不是 json", ex=TTL_S))
    assert await cache.get_json(key) is None


async def test_set_if_absent_lets_exactly_one_caller_win(
    cache: Cache, key: str
) -> None:
    assert await cache.set_if_absent(key, "first", ttl_s=TTL_S) is True
    assert await cache.set_if_absent(key, "second", ttl_s=TTL_S) is False
    assert await cache.get(key) == "first"


async def test_exists_and_delete_agree_on_presence(
    cache: Cache, key: str
) -> None:
    assert await cache.exists(key) is False
    await cache.set_json(key, 1, ttl_s=TTL_S)
    assert await cache.exists(key) is True
    await cache.delete(key)
    assert await cache.exists(key) is False


async def test_incr_in_window_counts_up_from_one(
    cache: Cache, key: str
) -> None:
    assert [
        await cache.incr_in_window(key, window_s=WINDOW_S) for _ in range(3)
    ] == [
        1,
        2,
        3,
    ]


async def test_incr_in_window_sets_the_ttl_only_on_the_first_hit(
    cache: Cache, key: str
) -> None:
    # ⚠ 每次都续期的话窗口永远不结束：被限流的人再也出不来
    await cache.incr_in_window(key, window_s=WINDOW_S)
    first = await cache._client.ttl(key)
    await cache.incr_in_window(key, window_s=WINDOW_S * 10)
    assert await cache._client.ttl(key) <= first


async def test_unreachable_server_raises_a_domain_exception() -> None:
    # ⚠ 基础设施异常不许裸露给上层：业务层不该认识 redis.RedisError
    broken = Cache(url="redis://127.0.0.1:1/0", timeout_s=0.2)
    with pytest.raises(DependencyUnavailable):
        await broken.get("anything")
    await broken.close()


async def test_ping_returns_false_instead_of_raising() -> None:
    broken = Cache(url="redis://127.0.0.1:1/0", timeout_s=0.2)
    assert await broken.ping() is False
    await broken.close()
